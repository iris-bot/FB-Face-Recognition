/*!
 * dependencies
 */

var express = require('express'),
    bodyParser = require('body-parser'),
    routes = require('./routes'),
    http = require('http'),
    path = require('path'),
    fs = require('fs'),
    logger = require('morgan'),
    errorHandler = require('errorhandler'),
    multipart = require('connect-multiparty'),
    methodOverride = require('method-override'),
    watson = require('watson-developer-cloud'),
	facebook = require('./facebook'),
	httprequest = require('request');

/*!
 * init
 */

var app = express();
var vr;
var cloudant;
var config = {};
var fileToUpload;
var dbCredentials = {};
var multipartMiddleware = multipart();
var facesCollection = {};

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(logger('dev'));
app.use(methodOverride());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/style', express.static(path.join(__dirname, '/views/style')));

app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.engine('html', require('ejs').renderFile);

// development only
if ('development' == app.get('env')) {
    app.use(errorHandler());
}


/*! 
 * cloudant connection setup
 */

function initDBConnection() {
   if (process.env.VCAP_SERVICES) {
      var vcapServices = JSON.parse(process.env.VCAP_SERVICES);
      for ( var vcapService in vcapServices) {
         if (vcapService.match(/cloudant/i)) {
            dbCredentials.host = vcapServices[vcapService][0].credentials.host;
            dbCredentials.port = vcapServices[vcapService][0].credentials.port;
            dbCredentials.user = vcapServices[vcapService][0].credentials.username;
            dbCredentials.password = vcapServices[vcapService][0].credentials.password;
            dbCredentials.url = vcapServices[vcapService][0].credentials.url;

            cloudant = require('cloudant')(dbCredentials.url);

            break;
         }
      }
   } else {
      console.warn('VCAP_SERVICES environment variable not set - data will be unavailable to the UI');
   }
}

var _dbUse = function(dbName) {
   cloudant.db.create(dbName, function(err, res) {});
   var db = cloudant.use(dbName);
   if (db == null) {
      console.warn('Could not find Cloudant credentials in VCAP_SERVICES environment variable - data will be unavailable to the UI');
   }
   return db;
}

var _dbGet = function(docType, _query, func) {
   cloudant.db.create(docType, function(err, res) {});
   var _db = cloudant.use(docType);
   if (!_query.selector._id) {
      _db.find(_query, func);
   } else {
      _db.get(_query.selector._id, func);
   }
}

var _dbPost = function(docType, data, func) {
   cloudant.db.create(docType, function(err, res) {});
   var _db = cloudant.use(docType);
   if (!isObject(data))
      data = {
         value : data
      };
   _db.insert(data, null, function(err, doc) {
      func(err, doc);
   });
}

var _dbPut = function(docType, data, func) {
   cloudant.db.create(docType, function(err, res) {});
   var _db = cloudant.use(docType);
   if (!isObject(data))
      data = {
         value : data
      };
   _db.insert(data, data._id, function(err, doc) {
      func(err, doc);
   });
}


initDBConnection();

var facesDB = _dbUse('faces_db');

/*!
 * configurations
 */

var configFB = function(){
	_dbGet('config', {selector:{}}, function(err,res){
		if(!err && res.docs.length>0){
			config = res.docs[0];		
			facebook.config(config.fb);
		}
	});
};

configFB();
	
var configVR = function(){
	_dbGet('config', {selector:{}}, function(err,res){
		if(!err && res.docs.length>0){
			config = res.docs[0];		
			
			vr = watson.visual_recognition({
			  api_key: config.api_key.visual_recognition,
			  version: 'v3',
			  version_date: '2016-05-19'
			});
			
			vr.listCollections({},function(err, res) {
			   if (!err){
					var cols = res.collections;
					for(var i in cols){
						if(cols[i].name==="faces"){
							facesCollection = cols[i];
						}
					}
					if(facesCollection===null || facesCollection==undefined){
						vr.createCollection({name:'faces'}, function(_err, _resp) {
			   	 			if (!err){
			   	 				facesCollection = _resp;
			   	 			}
			   	 		});
					}
			   }
			});
			
		}
	});
};

configVR();

/*!
 * functions
 */

function createResponseData(id, name, value, attachments) {

    var responseData = {
        id: id,
        name: sanitizeInput(name),
        value: value, //sanitizeInput(value),
        attachements: []
    };

	for(var k in attachments){
		var item = attachments[k];
		responseData.attachements.push({
			content_type: item.content_type,
            key: k,
            url: '/api/faces/attach?id=' + id + '&key=' + k
		});
	}

    return responseData;
}

function sanitizeInput(str) {
    return String(str).replace(/&(?!amp;|lt;|gt;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/*!
 * ROUTING FUNCTIONS
 */

var postApiFbRecognize = function(req, res){
	var imgUrl = req.body.img_url;
	if(!imgUrl) imgUrl = req.query.img_url;

	console.log("RECOGNIZE img: "+imgUrl);
	if(imgUrl) facebook.recognize(imgUrl, function(metadata){
		//res.write(JSON.stringify(metadata));
		//res.end;
		res.send(metadata);
	});
	else {
		var _req = {};
		for(var i in req){
			try{
				var obj = JSON.stringify(req[i]);
				_req[i] = JSON.parse(obj);
			}catch(e){}
		}
		res.send({request: _req});
	}

};

var getApiFacesAttach = function(request, response) {
    var doc = request.query.id;
    var key = request.query.key;

	facesDB.attachment.get(doc, key, function(err, body) {
        if (err) {
            response.status(500);
            response.setHeader('Content-Type', 'text/plain');
            response.write('Error: ' + err);
            response.end();
            return;
        }

        response.status(200);
        response.setHeader("Content-Disposition", 'inline; filename="' + key + '"');
        response.write(body);
        response.end();
        return;
    });
};

var postApiFacesAttach = function(request, response) {

    console.log("Upload File Invoked..");
    console.log('Request: ' + JSON.stringify(request.headers));

    var file = request.files.file;
    var location = {
    	latitude: request.query.latitude,
    	longitude: request.query.longitude,
    	altitude: request.query.altitude,
    	accuracy: request.query.accuracy,
    	date: new Date()
    };

	if(file){
	    facesDB.insert({
	        name: sanitizeInput(file.name),
	        trace:[location]
	    }, '', function(err, doc) {
	        if (err) console.log(err);
	        else {
	            fs.readFile(file.path, function(err, data) {
	            	if(!err){
	            		facesDB.attachment.insert((doc._id || doc.id), file.name, data, file.type, {rev: (doc._rev || doc.rev)}, 
	            		function(err, _d) {
	            			if(!err){
		                        console.log('Attachment saved successfully.. ');
		                        facesDB.get((_d.id || _d._id), function(err, _doc){
		                        	if(!err){
		                        		var url = '/api/faces/attach?id=' + (_d.id || _d._id) + '&key=' + file.name;
		                        		facebook.recognize(config['base-url']+url, function(metadata){
								        	var jstr = "null";
								        	try{jstr = JSON.stringify(metadata);}catch(e){}
								        	console.log("METADATA: "+jstr);
							        		response.write(jstr);
		                                    response.end();
				                            updateFaces(_doc, metadata);
		                                    return;
								        });
		                        	}
		                        });
	            			}
	            		});
	            	}
	            });
	        }
	    });
	}else{
		console.log("NO FILE TO ATTACH");
		response.write('{"error":"no file to attach"}');
        response.end();
        return;
	}

};

var delApiFaces = function(request, response) {

    console.log("Delete Invoked..");
    var id = request.query.id;
    // var rev = request.query.rev; // Rev can be fetched from request. if
    // needed, send the rev from client
    console.log("Removing document of ID: " + id);
    console.log('Request Query: ' + JSON.stringify(request.query));

    facesDB.get(id, {
        revs_info: true
    }, function(err, doc) {
        if (!err) {
            facesDB.destroy(doc._id, doc._rev, function(err, res) {
                // Handle response
                if (err) {
                    console.log(err);
                    response.sendStatus(500);
                } else {
                    response.sendStatus(200);
                }
            });
        }
    });

};

var getApiFaces = function(request, response) {

    console.log("Get method invoked.. ");

    var docList = [];
    var i = 0;
    facesDB.list(function(err, body) {
        if (!err) {
            var len = body.rows.length;
            console.log('total # of rows -> ' + len);

                body.rows.forEach(function(document) {

                    facesDB.get(document.id || document._id, {
                        revs_info: true
                    }, function(err, doc) {
                        if (!err && doc.value) {
                            docList.push(createResponseData(document.id || document._id, doc.name, doc.value, doc._attachments));
                            i++;
                            if (i >= len) {
                                response.write(JSON.stringify(docList));
                                console.log('ending response...');
                                response.end();
                            }
                        } else {
                            console.log(err);
                        }
                    });

                });

        } else {
            console.log(err);
        }
    });

};

var updateFaces = function(_doc, metadata) {

    if(metadata.error){
    	// NO FACEBOOK METADATA
    	console.log("FB_RECOG_ERR: "+metadata.error);
        facesDB.destroy((_doc._id || _doc.id), (_doc._rev || _doc.rev), function(err, res) {
            if (err) console.log(err);
            else console.log("REMOVED "+ (_doc._id || _doc.id));
        });
    }else{
    	console.log("LOKING FOR FBID: "+metadata.fbid);
    	facesDB.find({selector:{"value.fbid":metadata.fbid}}, function(err,res){
    		if(err) console.log("ERROR LOOKING FOR DOCS");
    		else{
    			console.log("FOUND: "+res.docs.length+" DOCS");
    			if(res.docs.length>0){
    				facesDB.get((res.docs[0]._id || res.docs[0].id), function(err, xdoc){
			    		if(err) console.log("ERROR FETCHING DOC "+(res.docs[0]._id || res.docs[0].id));
			    		else{
			    			xdoc.name = metadata.name;
    						xdoc.value = metadata;
    						xdoc.trace.push(_doc.trace[0]);
				            facesDB.insert(xdoc, (xdoc._id || xdoc.id), function(err, xdoc) {
				                if (err) console.log('Error updating '+ (xdoc._id || xdoc.id) +" -> " + err);
				                else{
									console.log('Successfuly updated XDOC: ' + (xdoc.id||xdoc._id));
						            for(var key in _doc._attachments){
						            	facesDB.attachment.get(_doc.id||_doc._id, key, {rev: (_doc._rev || _doc.rev)}, function(e, data){
						            		if(e) console.log("ERROR GETTING ATTACH -> "+e);
						            		else{
						            			facesDB.attachment.insert((xdoc._id || xdoc.id), key, data, _doc._attachments[key].content_type, {rev: (xdoc._rev || xdoc.rev)}, function(_e, _d) {
													if(_e) console.log("ERROR SAVING ATTACH -> "+_e);
													else{
														console.log("MOVE ATTACH TO "+(xdoc._id || xdoc.id)+" - Success!");
														facesDB.destroy(_doc._id, _doc._rev, function(err, res) {
											                if (err) console.log(err);
											                else console.log("REMOVED "+(_doc._id||_doc.id));
											            });
													} 
						            			});
						            		}
						            	});
						            }
					            }
				            });
    					}
    				});
    			}else{
    				_doc.name = metadata.name;
    				_doc.value = metadata;
		            facesDB.insert(_doc, (_doc._id || _doc.id), function(err, _doc) {
		                if (err) {
		                    console.log('Error updating '+ (_doc._id || _doc.id) +" -> " + err);
		                }else{
							console.log('Successfuly updated ' + (_doc._id || _doc.id));                	
		                }
		            });
    			}
    		}
    		
    	});
    }
};

/*! 
 * routes
 */

app.get('/', routes.index);

app.get('/getFbAccessToken', facebook.oldAccessToken);
app.post('/api/fb/recognize', postApiFbRecognize);

app.get('/api/faces/attach', getApiFacesAttach);
app.post('/api/faces/attach', multipartMiddleware, postApiFacesAttach);
app.delete('/api/faces', delApiFaces);
app.get('/api/faces', getApiFaces);

http.createServer(app).listen(app.get('port'), '0.0.0.0', function() {
    console.log('Express server listening on port ' + app.get('port'));
});

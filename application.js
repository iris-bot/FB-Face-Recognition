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


    attachments.forEach(function(item, index) {
        var attachmentData = {
            content_type: item.type || item.content_type,
            key: item.key,
            url: '/api/faces/attach?id=' + id + '&key=' + item.key
        };
        responseData.attachements.push(attachmentData);
    });
    
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

    var id;

	facesDB.get(request.query.id, function(err, existingdoc) {

        var isExistingDoc = false;
        if (!existingdoc) {
            id = '-1';
        } else {
            id = existingdoc.id;
            isExistingDoc = true;
        }

        var name = sanitizeInput(request.query.name);
        var value = sanitizeInput(request.query.value);

        var file = request.files.file;
        var newPath = './public/uploads/' + file.name;

        var insertAttachment = function(file, id, rev, name, value, response) {

            fs.readFile(file.path, function(err, data) {
                if (!err) {

                    if (file) {

                        facesDB.attachment.insert(id, file.name, data, file.type, {
                            rev: rev
                        }, function(err, document) {
                            if (!err) {
                                console.log('Attachment saved successfully.. ');

									facesDB.get(document.id, function(err, doc) {
                                    console.log('Attachements from server --> ' + JSON.stringify(doc._attachments));

                                    var attachements = [];
                                    var attachData;
                                    for (var attachment in doc._attachments) {
                                    	
                                    	
                                    	
                                        if (attachment == value) {
                                            attachData = {
                                                "key": attachment,
                                                "type": file.type
                                            };
                                        } else {
                                            attachData = {
                                                "key": attachment,
                                                "type": doc._attachments[attachment]['content_type']
                                            };
                                        }
                                        attachements.push(attachData);
                                    }
                                    var responseData = createResponseData(
                                        id,
                                        name,
                                        value,
                                        attachements);
                                        
                                    responseData.value = [];    
                                    responseData.attachements.forEach(function(item, index) {
								        facebook.recognize(config['base-url']+item.url, function(metadata){
								        	var jstr = "null";
								        	try{jstr = JSON.stringify(metadata);}catch(e){}
								        	console.log("METADATA: "+jstr);
								        	responseData.value.push(metadata);
								        	if(index==(responseData.attachements.length-1)){
			                                    console.log('Response after attachment: ' + JSON.stringify(responseData));
			                                    updateFaces(index, responseData);
								        		response.write(JSON.stringify(responseData));
			                                    response.end();
			                                    return;
								        	}
								        });
								    });
                                });
                            } else {
                                console.log(err);
                            }
                        });
                    }
                }
            });
        }

        if (!isExistingDoc) {
            existingdoc = {
                name: name,
                value: value,
                create_date: new Date()
            };

            // save doc
            facesDB.insert({
                name: name,
                value: value
            }, '', function(err, doc) {
                if (err) {
                    console.log(err);
                } else {

                    existingdoc = doc;
                    console.log("New doc created ..");
                    console.log(existingdoc);
                    insertAttachment(file, existingdoc.id, existingdoc.rev, name, value, response);

                }
            });

        } else {
            console.log('Adding attachment to existing doc.');
            console.log(existingdoc);
            insertAttachment(file, existingdoc._id, existingdoc._rev, name, value, response);
        }

    });

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
            console.log('total # of docs -> ' + len);

                body.rows.forEach(function(document) {

                    facesDB.get(document.id, {
                        revs_info: true
                    }, function(err, doc) {
                        if (!err) {
                            docList.push(createResponseData(document.id, doc.name, doc.value, doc.attachements));
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

var updateFaces = function(idx, _doc) {

    var id = _doc.id;

    console.log("UPDATING: " + id);

    facesDB.get(id, {
        revs_info: true
    }, function(err, doc) {
        if (!err) {
            console.log("" + JSON.stringify(doc));
            
            if(_doc.value[idx].error && idx==0){
            	// NO FACEBOOK METADATA
            	console.log("FB_RECOG_ERR: "+_doc.value[idx].error);
	            facesDB.destroy(doc._id, doc._rev, function(err, res) {
	                // Handle response
	                if (err) {
	                    console.log(err);
	                } else {
	                    console.log("REMOVED "+doc._id);
	                }
	            });
            }else{
            	console.log("LOKING FOR FBID: "+_doc.value[idx].fbid);
            	facesDB.find({selector:{"value.fbid":_doc.value[idx].fbid}}, function(err,res){
            		var _docs = res.docs;
            		console.log("FOUND: "+_docs.length+" DOCS");
            		if(_docs.length>0){
            			var xdoc = _docs[0];
            			xdoc.value = _doc.value[idx];
			            xdoc.name = _doc.value[idx].name;
			            xdoc.attachements.push(_doc.attachements[idx]);
			            xdoc = createResponseData(xdoc._id, xdoc.name, xdoc.value, xdoc.attachements);
			            console.log("XDOC contains "+xdoc.attachements.length+" attchs");
			            facesDB.insert(xdoc, xdoc.id, function(e, d) {
			                if (e) {
			                    console.log('Error updating '+ d.id +" -> " + e);
			                }else{
								console.log('Successfuly updated XDOC: ' + d.id);
								facesDB.destroy(doc._id, doc._rev, function(err, res) {
					                // Handle response
					                if (err) {
					                    console.log(err);
					                } else {
					                    console.log("REMOVED "+doc._id);
					                }
					            });
				            }
			            });
            		}else{
			            doc.value = _doc.value[idx];
			            doc.name = _doc.value[idx].name;
			            doc.attachements = _doc.attachements;
			            facesDB.insert(doc, doc.id, function(err, __doc) {
			                if (err) {
			                    console.log('Error updating '+ id +" -> " + err);
			                }else{
								console.log('Successfuly updated ' + id);                	
			                }
			            });
            		}
            	});
            }
        }
    });
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

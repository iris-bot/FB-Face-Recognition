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
	graph = require('fbgraph'),
	httprequest = require('request');

/*!
 * init
 */

var app = express();
var db;
var vr;
var cloudant;
var config = {};
var fileToUpload;
var dbCredentials = {};
var multipartMiddleware = multipart();
var facesCollection = {};

app.use(bodyParser.urlencoded({ extended: false }));
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
   db = cloudant.use(dbName);
   if (db == null) {
      console.warn('Could not find Cloudant credentials in VCAP_SERVICES environment variable - data will be unavailable to the UI');
   } else {
      return db;
   }
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


/*!
 * configurations
 */

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

/*!
 * functions
 */

function createResponseData(id, name, value, attachments) {

    var responseData = {
        id: id,
        name: sanitizeInput(name),
        value: sanitizeInput(value),
        attachements: []
    };


    attachments.forEach(function(item, index) {
        var attachmentData = {
            content_type: item.type,
            key: item.key,
            url: '/api/favorites/attach?id=' + id + '&key=' + item.key
        };
        responseData.attachements.push(attachmentData);

    });
    return responseData;
}

function sanitizeInput(str) {
    return String(str).replace(/&(?!amp;|lt;|gt;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

var saveDocument = function(id, name, value, response) {

    if (id === undefined) {
        // Generated random id
        id = '';
    }

    db.insert({
        name: name,
        value: value
    }, id, function(err, doc) {
        if (err) {
            console.log(err);
            response.sendStatus(500);
        } else
            response.sendStatus(200);
        response.end();
    });

};

/*!
 * facebook functions
 */

var fbRecognize = function(imgId, callback) {
  httprequest.post({
    url:'https://www.facebook.com/photos/tagging/recognition/?dpr=1.5',
    headers: {
       'x_fb_background_state': 1,
       'origin': 'https://www.facebook.com',
       'accept-encoding': 'gzip, deflate, lzma',
       'accept-language': 'en-US,en;q=0.8',
       'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.106 Safari/537.36',
       'content-type': 'application/x-www-form-urlencoded',
       'accept': '*/*',
       'referer': 'https://www.facebook.com/',
       'cookie': config.fb.cookies
    },
    body: 'recognition_project=composer_facerec&photos[0]=' + imgId + '&target&is_page=false&include_unrecognized_faceboxes=false&include_face_crop_src=false&include_recognized_user_profile_picture=false&include_low_confidence_recognitions=false&' + config.fb.req_params,
    gzip: true
  }, function cb(err, httpResponse, body) {
      
      try{
	      var json = JSON.parse(body.replace('for (;;);', ''));
	      callback(json.payload[0].faceboxes);
      }catch(e){
      	  console.error(e);
      	  console.log("BODY: "+body);
      }
  });
};

var recognize = function(imgUrl, _callback){
  httprequest.get({url:'https://fb-face-recognition.mybluemix.net/getFbAccessToken',
      headers: {
       'x_fb_background_state': 1,
       'origin': 'https://www.facebook.com',
       'accept-encoding': 'gzip, deflate, lzma',
       'accept-language': 'en-US,en;q=0.8',
       'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.106 Safari/537.36',
       'content-type': 'application/x-www-form-urlencoded',
       'accept': '*/*',
       'referer': 'https://www.facebook.com/',
       'cookie': config.fb.cookies
    }, function(err, httpResp, body){
	  // vars
	  _callback(body);
	  
//	  var accessToken = body.access_token;
//	  // set access_token to upload image
//	  graph.setAccessToken(accessToken);
//	  // upload image
//	  var params = {
//	    url: imgUrl, 
//	    message:'temp', 
//	    privacy: { value: 'SELF' } // we don't want other people to see it
//	  };
//	  graph.post('/me/photos', params, function(err, r) {
//	    // we have the imgId! now we can ask Facebook to recognize my friends
//	    var imgId = r.id;
//	    // wait 3 seconds before asking Facebook (they recognize asynchronously)
//	    setTimeout(function() {
//	      fbRecognize(imgId, function(result) {
//	        if(result.length === 0) {
//	          _callback({ error: 'Facebook couldn\'t recognize this picture.' });
//	        } else {
//	          _callback(result);
//	        }
//	      });
//	    }, 3000);
//	  });
  });
};   

/*! 
 * routes
 */

app.get('/', routes.index);


/*
 * facebook routes
 */

app.get('/getFbAccessToken', function(req, res){

  // we don't have a code yet, go to auth
  if (!req.query.code) {
    var authUrl = graph.getOauthUrl({
      client_id: config.fb.client_id,
      redirect_uri: 'https://fb-face-recognition.mybluemix.net/getFbAccessToken',
      scope: config.fb.scope
    });
    if (!req.query.error) res.redirect(authUrl);
    else res.send('access denied');
    return ;
  }

  // code is set, let's get that access token
  graph.authorize({
    client_id:      config.fb.client_id,
    redirect_uri:   'https://fb-face-recognition.mybluemix.net/getFbAccessToken',
    client_secret:  config.fb.client_secret,
    code:           req.query.code
  }, function (err, facebookRes) {
    res.send(facebookRes);
  });	

});

app.get('/recognize', function(req, res){
	
	recognize('https://fb-face-recognition.mybluemix.net/api/favorites/attach?id=709debcdc588c6e7f41f38a2e88e5e14&key=face1374472490.jpg', function(body){
		res.send(body);
	});
	
});

/*
 *  persistence routes
 */

app.get('/api/favorites/attach', function(request, response) {
    var doc = request.query.id;
    var key = request.query.key;

	_dbUse('my_sample_db');
    db.attachment.get(doc, key, function(err, body) {
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
});

app.post('/api/favorites/attach', multipartMiddleware, function(request, response) {

    console.log("Upload File Invoked..");
    console.log('Request: ' + JSON.stringify(request.headers));

    var id;

	_dbUse('my_sample_db');
    db.get(request.query.id, function(err, existingdoc) {

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

						_dbUse('my_sample_db');
                        db.attachment.insert(id, file.name, data, file.type, {
                            rev: rev
                        }, function(err, document) {
                            if (!err) {
                                console.log('Attachment saved successfully.. ');

                                	_dbUse('my_sample_db');
									db.get(document.id, function(err, doc) {
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
                                    console.log('Response after attachment: \n' + JSON.stringify(responseData));
                                    response.write(JSON.stringify(responseData));
                                    response.end();
                                    return;
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
            _dbUse('my_sample_db');
            db.insert({
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

});

app.post('/api/favorites', function(request, response) {

    console.log("Create Invoked..");
    console.log("Name: " + request.body.name);
    console.log("Value: " + request.body.value);

    // var id = request.body.id;
    var name = sanitizeInput(request.body.name);
    var value = sanitizeInput(request.body.value);

    saveDocument(null, name, value, response);

});

app.delete('/api/favorites', function(request, response) {

    console.log("Delete Invoked..");
    var id = request.query.id;
    // var rev = request.query.rev; // Rev can be fetched from request. if
    // needed, send the rev from client
    console.log("Removing document of ID: " + id);
    console.log('Request Query: ' + JSON.stringify(request.query));

    _dbUse('my_sample_db');
    db.get(id, {
        revs_info: true
    }, function(err, doc) {
        if (!err) {
            _dbUse('my_sample_db');
            db.destroy(doc._id, doc._rev, function(err, res) {
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

});

app.put('/api/favorites', function(request, response) {

    console.log("Update Invoked..");

    var id = request.body.id;
    var name = sanitizeInput(request.body.name);
    var value = sanitizeInput(request.body.value);

    console.log("ID: " + id);

    _dbUse('my_sample_db');
    db.get(id, {
        revs_info: true
    }, function(err, doc) {
        if (!err) {
            console.log(doc);
            doc.name = name;
            doc.value = value;
            _dbUse('my_sample_db');
            db.insert(doc, doc.id, function(err, doc) {
                if (err) {
                    console.log('Error inserting data\n' + err);
                    return 500;
                }
                return 200;
            });
        }
    });
});

app.get('/api/favorites', function(request, response) {

    console.log("Get method invoked.. ")

    _dbUse('my_sample_db');
    var docList = [];
    var i = 0;
    db.list(function(err, body) {
        if (!err) {
            var len = body.rows.length;
            console.log('total # of docs -> ' + len);
            if (len == 0) {
                // push sample data
                // save doc
                var docName = 'sample_doc';
                var docDesc = 'A sample Document';
                _dbUse('my_sample_db');
                db.insert({
                    name: docName,
                    value: 'A sample Document'
                }, '', function(err, doc) {
                    if (err) {
                        console.log(err);
                    } else {

                        console.log('Document : ' + JSON.stringify(doc));
                        var responseData = createResponseData(
                            doc.id,
                            docName,
                            docDesc, []);
                        docList.push(responseData);
                        response.write(JSON.stringify(docList));
                        console.log(JSON.stringify(docList));
                        console.log('ending response...');
                        response.end();
                    }
                });
            } else {

                body.rows.forEach(function(document) {

                    _dbUse('my_sample_db');
                    db.get(document.id, {
                        revs_info: true
                    }, function(err, doc) {
                        if (!err) {
                            if (doc['_attachments']) {

                                var attachments = [];
                                for (var attribute in doc['_attachments']) {

                                    if (doc['_attachments'][attribute] && doc['_attachments'][attribute]['content_type']) {
                                        attachments.push({
                                            "key": attribute,
                                            "type": doc['_attachments'][attribute]['content_type']
                                        });
                                    }
                                    console.log(attribute + ": " + JSON.stringify(doc['_attachments'][attribute]));
                                }
                                var responseData = createResponseData(
                                    doc._id,
                                    doc.name,
                                    doc.value,
                                    attachments);

                            } else {
                                var responseData = createResponseData(
                                    doc._id,
                                    doc.name,
                                    doc.value, []);
                            }

                            docList.push(responseData);
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
            }

        } else {
            console.log(err);
        }
    });

});


http.createServer(app).listen(app.get('port'), '0.0.0.0', function() {
    console.log('Express server listening on port ' + app.get('port'));
});

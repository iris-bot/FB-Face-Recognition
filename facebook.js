/*!
 * dependencies
 *    "fbgraph": "1.1.0"
 *    "request": "2.67.0"
 */

var _graph = require('fbgraph');

var httpheaders = function() {
		return {
			'x_fb_background_state': 1,
			'origin': 'https://www.facebook.com',
			'accept-language': 'en-US,en;q=0.8',
			'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10; rv:33.0) Gecko/20100101 Firefox/33.0',
			'accept': '*/*',
			'referer': 'https://www.facebook.com/'
		};
};

exports.getAccessToken = function(cfg, req, res) {
	if (!req.query.code) {
		res.send({
			"error": {"message":"missing authentication code",
			"code": -403}
		});
	} else {
		_graph.authorize({
			client_id: cfg.client_id,
			redirect_uri: cfg.url_redirect,
			client_secret: cfg.client_secret,
			code: req.query.code
		}, function(err, facebookRes) {
			res.send(facebookRes);
		});
	}
};

exports.oldAccessToken = function(cfg, req, res) {
	// we don't have a code yet, go to auth
	if (!req.query.code) {
		var authUrl = _graph.getOauthUrl({
			client_id: cfg.client_id,
			redirect_uri: cfg.url_redirect,
			scope: cfg.scope
		});

		if (!req.query.error) res.redirect(authUrl);
		else res.send('access denied');
		return;
	}
	// code is set, let's get that access token
	_graph.authorize({
		client_id: cfg.client_id,
		redirect_uri: cfg.url_redirect,
		client_secret: cfg.client_secret,
		code: req.query.code
	}, function(err, facebookRes) {
		res.send(facebookRes);
	});
};

exports.fbSession = function(cfg) {
	return {
		graph: require('fbgraph'),
		httprequest: require('request'),
		
		getAuthCodeURL: function(_callback) {
			var THIS = this;
			var headers = httpheaders();
			headers['content-type'] = 'application/json';
			headers['cookie'] = cfg.cookies;
			THIS.httprequest.get({
				url: THIS.graph.getOauthUrl({
					client_id: cfg.client_id,
					redirect_uri: cfg.url_redirect,
					scope: cfg.scope
				}),
				headers: headers
			}, function(err, httpResp, body) {
				var _start = body.indexOf("href=") + 6;
				var _end = body.indexOf("\";");
				var _url = body.substring(_start, _end);
				while (_url.indexOf("\\") > -1) _url = _url.replace("\\", "");
				_callback(_url);
			});
		},	
		
		getRecognitionMetadata: function(imgId, callback, _ct) {
			var THIS = this;
			console.log("trying IMG-ID: " + imgId + " (" + _ct + ")");
			var headers = httpheaders();
			headers['accept-encoding'] = 'gzip, deflate, lzma';
			headers['content-type'] = 'application/x-www-form-urlencoded';
			headers['cookie'] = cfg.cookies;
			var req_parms = cfg.req_params;
			setTimeout(function() {
				THIS.httprequest.post({
					url: 'https://www.facebook.com/photos/tagging/recognition/?dpr=1.5',
					headers: headers,
					body: 'recognition_project=composer_facerec&photos[0]=' + imgId + '&target&is_page=false&include_unrecognized_faceboxes=false&include_face_crop_src=false&include_recognized_user_profile_picture=false&include_low_confidence_recognitions=false&' + req_parms,
					gzip: true
				}, function(err, httpResponse, body) {
					console.log("RAW-FB-DATA("+ imgId +" || "+ _ct +"): " + body);
					var json;
					try {
						json = JSON.parse(body.replace('for (;;);', ''));
						if ((json.payload == null || json.payload.length == 0) && _ct < 15) THIS.getRecognitionMetadata(imgId, callback, _ct + 1);
						else THIS.cleanImagePost(imgId, callback, json.payload[0].faceboxes);
					} catch (e) {
						THIS.cleanImagePost(imgId, callback, json.payload);
					}
				});
			}, 500);
		},
		
		cleanImagePost: function(imgId, callback, recogData) {
			var THIS = this;
			THIS.graph.del(imgId, function(err, r) {
				callback(recogData);
			});
		},

		recognize: function(imgUrl, _callback) {
			var THIS = this;
			console.log("FB_RECOG_IMG: " + imgUrl);
			var headers = httpheaders();
			headers['content-type'] = 'application/json';
			headers['cookie'] = cfg.cookies;
		
			THIS.getAuthCodeURL(function(_url) {
				console.log("FB_AUTH_URL: " + _url);
				THIS.httprequest.get({
					url: _url,
					headers: headers
				}, function(err, httpResp, _body) {
					var body = JSON.parse(_body);
					var accessToken = body.access_token;
					THIS.graph.setAccessToken(accessToken);
					var params = {
						url: imgUrl,
						message: 'temp',
						privacy: {
							value: 'SELF'
						}
					};
					THIS.graph.post('/me/photos', params, function(err, r) {
						var imgId = r.id;
		
						if (!imgId) {
							_callback({
								error: {"message":'Failed sending picture to Facebook.',
								code: -499}
							});
							return;
						}
		
						console.log("IMG_ID: " + imgId);
						THIS.getRecognitionMetadata(imgId, function(result) {
							if (!result) {
								_callback({
									error: {"message": 'Facebook returned no data.',
									code: -500}
								});
							} else if (result.length == 0) {
								_callback({
									error: {"message": 'Facebook couldn\'t detect any face.',
									code: -501}
								});
							} else if (result[0].recognitions.length === 0) {
								_callback({
									error: {"message": 'Facebook couldn\'t recognize this picture.',
									code: -502}
								});
							} else if (result[0].recognitions[0].certainty < 0.85) {
								_callback({
									error: {"message": 'Facebook recognition has a low certainty for this picture.',
									code: -503}
								});
							} else {
								var mdata = {
									certainty: result[0].recognitions[0].certainty,
									name: result[0].recognitions[0].user.name,
									fbid: result[0].recognitions[0].user.fbid
								};
								THIS.graph.get(mdata.fbid + "?fields=id,name,gender,hometown,education,birthday,email,interested_in,link,relationship_status,devices",
									function(err, _res) {
										for (var k in _res) mdata[k] = _res[k];
										_callback(mdata);
									});
							}
						}, 0);
					});
				});
			});
		},
		
		_dummy: null
	};
};

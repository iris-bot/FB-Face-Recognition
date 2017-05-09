/*!
 * dependencies
 *    "fbgraph": "1.1.0"
 *    "request": "2.67.0"
 */

var
	graph = require('fbgraph'),
	httprequest = require('request'),

	httpheaders = function() {
		return {
			'x_fb_background_state': 1,
			'origin': 'https://www.facebook.com',
			'accept-language': 'en-US,en;q=0.8',
			'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10; rv:33.0) Gecko/20100101 Firefox/33.0',
			'accept': '*/*',
			'referer': 'https://www.facebook.com/'
		};
	},

	/*!
	 * keep this information in a safe place
	 * and overwrite it in runtime
	 */
	config = {
		client_id: "your client id",
		client_secret: "your client secret",
		client_token: "your client token",
		scope: "publish_actions",
		cookies: "fr=...; sb=....; lu=...; datr=...; dats=1; locale=...; c_user=...; xs=...; pl=n; act=...; presence=...",
		req_params: "__user=...",
		url_redirect: "url to your authentication end-point"
	},

	getAuthCodeURL = function(_callback) {
		var headers = httpheaders();
		headers['content-type'] = 'application/json';
		headers['cookie'] = config.cookies;
		httprequest.get({
			url: graph.getOauthUrl({
				client_id: config.client_id,
				redirect_uri: config.url_redirect,
				scope: config.scope
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

	cleanImagePost = function(imgId, callback, recogData) {
		graph.del(imgId, function(err, r) {
			callback(recogData);
		});
	},

	getRecognitionMetadata = function(imgId, callback, _ct) {
		console.log("IMG-ID: " + imgId + " (" + _ct + ")");
		var headers = httpheaders();
		headers['accept-encoding'] = 'gzip, deflate, lzma';
		headers['content-type'] = 'application/x-www-form-urlencoded';
		headers['cookie'] = config.cookies;
		setTimeout(function() {
			httprequest.post({
				url: 'https://www.facebook.com/photos/tagging/recognition/?dpr=1.5',
				headers: headers,
				body: 'recognition_project=composer_facerec&photos[0]=' + imgId + '&target&is_page=false&include_unrecognized_faceboxes=false&include_face_crop_src=false&include_recognized_user_profile_picture=false&include_low_confidence_recognitions=false&' + config.req_params,
				gzip: true
			}, function(err, httpResponse, body) {
				var json;
				try {
					json = JSON.parse(body.replace('for (;;);', ''));
					if (json.payload == null && _ct < 5) getRecognitionMetadata(imgId, callback, _ct + 1);
					else cleanImagePost(imgId, callback, json.payload[0].faceboxes);
				} catch (e) {
					cleanImagePost(imgId, callback, json.payload);
				}
			});
		}, 1500);
	};


exports.oldAccessToken = function(req, res) {
	// we don't have a code yet, go to auth
	if (!req.query.code) {
		var authUrl = graph.getOauthUrl({
			client_id: config.client_id,
			redirect_uri: config.url_redirect,
			scope: config.scope
		});

		if (!req.query.error) res.redirect(authUrl);
		else res.send('access denied');
		return;
	}
	// code is set, let's get that access token
	graph.authorize({
		client_id: config.client_id,
		redirect_uri: config.url_redirect,
		client_secret: config.client_secret,
		code: req.query.code
	}, function(err, facebookRes) {
		res.send(facebookRes);
	});
};

/*!
 * expose this method to overwrite config parameters
 */
exports.config = function(cfg) {
	config = cfg;
};

/*!
 * expose this method as your authentication end-point
 */
exports.getAccessToken = function(req, res) {
	if (!req.query.code) {
		res.send({
			"error": "missing authentication code"
		});
	} else {
		graph.authorize({
			client_id: config.client_id,
			redirect_uri: config.url_redirect,
			client_secret: config.client_secret,
			code: req.query.code
		}, function(err, facebookRes) {
			res.send(facebookRes);
		});
	}
};

/*!
 * method to retrieve face recognition metadata
 */
exports.recognize = function(imgUrl, _callback) {
	console.log("FB_RECOG_IMG: " + imgUrl);
	var headers = httpheaders();
	headers['content-type'] = 'application/json';
	headers['cookie'] = config.cookies;
	getAuthCodeURL(function(_url) {
		console.log("FB_AUTH_URL: " + _url);
		httprequest.get({
			url: _url,
			headers: headers
		}, function(err, httpResp, _body) {
			var body = JSON.parse(_body);
			var accessToken = body.access_token;
			graph.setAccessToken(accessToken);
			var params = {
				url: imgUrl,
				message: 'temp',
				privacy: {
					value: 'SELF'
				}
			};
			graph.post('/me/photos', params, function(err, r) {
				var imgId = r.id;
				console.log("FB_IMG_ID: " + imgId);
				getRecognitionMetadata(imgId, function(result) {
					if (result.length === 0) {
						_callback({
							error: 'Facebook couldn\'t detect any face.'
						});
					}else if(result[0].recognitions.length === 0){
						_callback({
							error: 'Facebook couldn\'t recognize this picture.'
						});
					} else {
						_callback({
							certainty: result[0].recognitions[0].certainty,
							name: result[0].recognitions[0].user.name,
							fbid: result[0].recognitions[0].user.fbid
						});
					}
				}, 0);
			});
		});
	});
};
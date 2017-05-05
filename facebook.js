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
			'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.106 Safari/537.36',
			'accept': '*/*',
			'referer': 'https://www.facebook.com/'
		};
	};

module.exports = {

	/*!
	 * keep this information in a safe place
	 * and overwrite it in runtime
	 */
	var config = {
		client_id: "your client id",
		client_secret: "your client secret",
		client_token: "your client token",
		scope: "publish_actions",
		cookies: "fr=...; sb=....; lu=...; datr=...; dats=1; locale=...; c_user=...; xs=...; pl=n; act=...; presence=...",
		req_params: "__user=...",
		url_redirect: "url to your authentication end-point"
	};

	/*!
	 * expose this method as your authentication end-point
	 */
	var getAccessToken = function(req, res) {
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

	private getAuthCodeURL = function(_callback) {
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
	};

	private getRecognitionMetadata = function(imgId, callback) {
		var headers = httpheaders();
		headers['content-type'] = 'application/x-www-form-urlencoded';
		headers['cookie'] = config.cookies;
		httprequest.post({
			url: 'https://www.facebook.com/photos/tagging/recognition/?dpr=1.5',
			headers: headers,
			body: 'recognition_project=composer_facerec&photos[0]=' + imgId + '&target&is_page=false&include_unrecognized_faceboxes=false&include_face_crop_src=false&include_recognized_user_profile_picture=false&include_low_confidence_recognitions=false&' + config.fb.req_params,
			gzip: true
		}, function cb(err, httpResponse, body) {
			try {
				var json = JSON.parse(body.replace('for (;;);', ''));
				callback(json.payload[0].faceboxes);
			} catch (e) {
				callback(body);
			}
		});
	};

	/*!
	 * method to retrieve face recognition metadata
	 */
	var recognize = function(imgUrl, _callback) {
		var headers = httpheaders();
		headers['content-type'] = 'application/json';
		headers['cookie'] = config.cookies;
		getAuthCodeURL(function(_url) {
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
					setTimeout(function() {
						getRecognitionMetadata(imgId, function(result) {
							if (result.length === 0) {
								_callback({
									error: 'Facebook couldn\'t recognize this picture.'
								});
							} else {
								_callback(result);
							}
						});
					}, 3000);
				});
			});
		});
	};

};
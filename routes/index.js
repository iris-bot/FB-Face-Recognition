
/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index.html', { title: 'Cloudant Boiler Plate' });
};

//module.exports = {
//  getAccessToken: require('./getAccessToken'),
//  recognize: require('./recognize')
//};
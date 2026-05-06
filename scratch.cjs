const bwipjs = require('bwip-js');
bwipjs.toBuffer({ bcid: 'ean13', text: '12345678' }, function (err, png) {
  if (err) {
    console.error(err.message);
  } else {
    console.log('success');
  }
});

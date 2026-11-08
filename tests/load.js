const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['fraction', 'matrix', 'ops', 'expr']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), { filename: f + '.js' });
module.exports = globalThis.MX;

const ini = require('ini');

const testINI = `[Test]
CopyToDir=\\\\cpc-srv-perseu\\InputFiles\\MPAG\\Banrisul\\\\
DirName=C:\\\\BCOM\\\\INBOX`;

console.log('Original INI:');
console.log(testINI);

const parsed = ini.parse(testINI);
console.log('\nParsed:');
console.log(JSON.stringify(parsed, null, 2));

console.log('\nActual values:');
console.log('CopyToDir:', parsed.Test.CopyToDir);
console.log('DirName:', parsed.Test.DirName);
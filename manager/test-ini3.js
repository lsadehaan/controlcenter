const { importFromINI } = require('./src/utils/ini-converter');

const testINI = `[Test UNC Path]
CopyToDir=\\\\cpc-srv-perseu\\InputFiles\\MPAG\\Banrisul\\\\
DirName=C:\\\\BCOM\\\\INBOX`;

console.log('Testing INI import with UNC paths:');
const rules = importFromINI(testINI);
console.log(JSON.stringify(rules, null, 2));
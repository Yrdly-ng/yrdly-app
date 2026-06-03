const fs = require('fs');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.tsx') || file.endsWith('.ts')) results.push(file);
    }
  });
  return results;
}

const files = walk('./src/components').concat(walk('./src/app'));

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;
  
  content = content.replace(/const FONT_PACIFICO = "Pacifico, cursive";/g, 'const FONT_PACIFICO = "var(--font-jersey25)";');
  content = content.replace(/font-pacifico/g, 'font-jersey25');
  
  // also login layout
  if (file.includes('login/layout.tsx')) {
    content = content.replace(/import { Pacifico, Inter } from 'next\/font\/google';/g, "import { Inter } from 'next/font/google';");
    content = content.replace(/const pacifico = Pacifico\({[^\}]+}\);/g, '');
    content = content.replace(/\$\{pacifico\.variable\}/g, '');
  }

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
  }
});
console.log("Done");

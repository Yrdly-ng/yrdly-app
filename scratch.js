const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.resolve(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('./src/components').concat(walk('./src/app'));
const iconButtonFiles = new Set();

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  if (
    content.includes('size="icon"') || 
    content.match(/<button[^>]+(?:w-[4568]|h-[4568]|w-10|h-10)[^>]*>[^a-zA-Z0-9]*<[A-Z]/g) ||
    content.match(/<Button[^>]+(?:w-[4568]|h-[4568]|w-10|h-10)[^>]*>[^a-zA-Z0-9]*<[A-Z]/g)
  ) {
    iconButtonFiles.add(file.replace(path.resolve('./src') + '/', ''));
  }
});

console.log(Array.from(iconButtonFiles).join('\n'));

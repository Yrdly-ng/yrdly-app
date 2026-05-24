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

const files = walk('./src');
let changedFiles = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;
  
  // Regex to match <Image> tags that have `fill` but don't have `sizes`
  const regex = /<Image([^>]*?)(?:\s+fill)([^>]*?)>/g;
  
  content = content.replace(regex, (match, p1, p2) => {
    if (match.includes('sizes=')) {
      return match;
    }
    return `<Image${p1} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"${p2}>`;
  });
  
  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf8');
    changedFiles++;
  }
});

console.log(`Updated sizes in ${changedFiles} files.`);

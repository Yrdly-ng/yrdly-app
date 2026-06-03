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
  
  // Tailwind classes
  content = content.replace(/bg-\[#388E3C\]/g, 'bg-primary');
  content = content.replace(/text-\[#388E3C\]/g, 'text-primary');
  content = content.replace(/border-\[#388E3C\]/g, 'border-primary');
  content = content.replace(/from-\[#388E3C\]/g, 'from-primary');
  content = content.replace(/to-\[#388E3C\]/g, 'to-primary');
  content = content.replace(/via-\[#388E3C\]/g, 'via-primary');
  content = content.replace(/ring-\[#388E3C\]/g, 'ring-primary');
  
  // Tailwind with opacity
  content = content.replace(/bg-\[#388E3C\]\/([0-9]+)/g, 'bg-primary/$1');
  content = content.replace(/border-\[#388E3C\]\/([0-9]+)/g, 'border-primary/$1');
  content = content.replace(/text-\[#388E3C\]\/([0-9]+)/g, 'text-primary/$1');

  // Inline styles and JS strings for green
  content = content.replace(/"#388E3C"/g, '"hsl(var(--primary))"');
  content = content.replace(/'#388E3C'/g, "'hsl(var(--primary))'");

  // Light green tint
  content = content.replace(/bg-\[#EBF5EB\]/g, 'bg-accent');
  content = content.replace(/text-\[#EBF5EB\]/g, 'text-accent');
  content = content.replace(/border-\[#EBF5EB\]/g, 'border-accent');
  content = content.replace(/bg-\[#EBF5EB\]\/([0-9]+)/g, 'bg-accent/$1');
  content = content.replace(/"#EBF5EB"/g, '"hsl(var(--accent))"');
  content = content.replace(/'#EBF5EB'/g, "'hsl(var(--accent))'");

  // Replace bg-white and bg-black and text-black with theme variables
  // Careful: bg-white -> bg-card or bg-background ? Usually bg-card or bg-background.
  // Wait, the user specifically mentioned "bg-white, and bg-background". We can change bg-white to bg-card, and bg-black to bg-foreground.
  content = content.replace(/bg-white\b/g, 'bg-background');
  content = content.replace(/text-black\b/g, 'text-foreground');
  content = content.replace(/text-white\b/g, 'text-primary-foreground'); 
  content = content.replace(/border-white\b/g, 'border-border');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
  }
});
console.log("Done");

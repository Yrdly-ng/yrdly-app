import os
import re

files = [
    'src/components/events/EventCreatorOnboarding.tsx',
    'src/components/marketplace/MarketplaceCreatorOnboarding.tsx'
]

for filepath in files:
    if os.path.exists(filepath):
        with open(filepath, 'r') as f:
            content = f.read()
        
        # Replace white backgrounds with subtle theme-aware borders or muted backgrounds
        # For the progress bar background (line 96)
        content = re.sub(
            r'style=\{\{\s*background:\s*"rgba\(255,255,255,0.05\)"\s*\}\}', 
            'style={{ background: "var(--c-border)" }}', 
            content
        )
        
        # For the close button (line 107)
        content = re.sub(
            r'style=\{\{\s*background:\s*"rgba\(255,255,255,0.08\)"\s*\}\}', 
            'style={{ background: "var(--c-border)" }}', 
            content
        )
        
        # For the feature list items (line 200)
        content = re.sub(
            r'style=\{\{\s*background:\s*"rgba\(255,255,255,0.03\)"\s*\}\}', 
            'style={{ border: "1px solid var(--c-border)" }}', 
            content
        )

        with open(filepath, 'w') as f:
            f.write(content)
        print(f'Updated {filepath}')

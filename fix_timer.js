const fs = require('fs');
const file = 'src/app/(app)/transactions/[transactionId]/confirm-receipt/page.tsx';
let code = fs.readFileSync(file, 'utf8');

// Add imports
code = code.replace(
  'import { useState, useCallback } from "react";',
  'import { useState, useCallback, useEffect } from "react";\nimport { supabase } from "@/lib/supabase";'
);

// Add state and effect
const stateToAdd = `
  const [loading, setLoading] = useState(false);
  const [shippedAt, setShippedAt] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState({ hours: 48, minutes: 0, seconds: 0 });
  const [strokeOffset, setStrokeOffset] = useState(140);

  useEffect(() => {
    async function fetchTx() {
      const { data } = await supabase.from('escrow_transactions').select('shipped_at').eq('id', transactionId).single();
      if (data?.shipped_at) setShippedAt(data.shipped_at);
    }
    fetchTx();
  }, [transactionId]);

  useEffect(() => {
    if (!shippedAt) return;
    
    const interval = setInterval(() => {
      const shippedTime = new Date(shippedAt).getTime();
      const deadline = shippedTime + 48 * 60 * 60 * 1000;
      const now = Date.now();
      const diff = deadline - now;
      
      if (diff <= 0) {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
        setStrokeOffset(565.48); // Full circle stroke hidden
        clearInterval(interval);
        return;
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeLeft({ hours, minutes, seconds });
      
      // Update SVG stroke (0 = full circle, 565.48 = empty)
      // Percentage of time elapsed: 0 to 1
      const totalTime = 48 * 60 * 60 * 1000;
      const elapsed = totalTime - diff;
      const percentage = elapsed / totalTime;
      // dasharray is 565.48. dashoffset goes from 0 (full) to 565.48 (empty).
      // At start (0% elapsed), it's full (0 offset). At end (100% elapsed), it's empty (565.48).
      setStrokeOffset(percentage * 565.48);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [shippedAt]);

  const pad = (n: number) => n.toString().padStart(2, '0');
  const timerDisplay = \`\${pad(timeLeft.hours)}:\${pad(timeLeft.minutes)}:\${pad(timeLeft.seconds)}\`;
`;

code = code.replace('  const [loading, setLoading] = useState(false);', stateToAdd);

// Replace timer display
code = code.replace(
  'strokeDashoffset="140"',
  'strokeDashoffset={strokeOffset}'
);

code = code.replace(
  '48:00:00</span>',
  '{timerDisplay}</span>'
);

fs.writeFileSync(file, code);

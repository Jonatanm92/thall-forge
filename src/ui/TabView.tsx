// Renders the generated guitar riff as classic ASCII tab the user can read,
// screenshot, or copy.

import { useMemo, useState } from 'react';
import { renderTab, tabToText } from '../engine/tab';
import { getTuning } from '../engine/theory';
import type { Pattern } from '../engine/types';

interface Props {
  pattern: Pattern;
  tuningId: string;
}

export function TabView({ pattern, tuningId }: Props) {
  const [copied, setCopied] = useState(false);
  const guitar = pattern.tracks.find((t) => t.role === 'guitar');
  const tuning = getTuning(tuningId);

  const tab = useMemo(() => {
    if (!guitar) return null;
    return renderTab(guitar, tuning, pattern.length, pattern.stepsPerBeat, pattern.beatsPerBar);
  }, [guitar, tuning, pattern.length, pattern.stepsPerBeat, pattern.beatsPerBar]);

  if (!tab) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(tabToText(tab));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  };

  return (
    <div>
      <div className="tab-head">
        <span className="muted small">Guitar tab · {tuning.name}</span>
        <button className="tiny" onClick={onCopy}>{copied ? 'Copied!' : 'Copy tab'}</button>
      </div>
      <pre className="tab-pre">
        {tab.lines.map((line, i) => (
          <div key={i}>
            <span className="tab-string">{tab.labels[i]}</span>
            {line}
          </div>
        ))}
      </pre>
    </div>
  );
}

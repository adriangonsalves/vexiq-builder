import React from 'react';
import { CircleHelp } from 'lucide-react';

/**
 * The small question mark on a tool panel or dialog (openspec in-app-help, "Help from tool panels and
 * dialogs"): opens the guide at that tool's page without closing or changing the tool.
 */
export default function HelpQ({ tool, onHelp, className = '' }) {
  if (!onHelp) return null;
  return (
    <button
      type="button"
      className={`help-q ${className}`.trim()}
      aria-label={`Help with ${tool}`}
      title={`Help with ${tool}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onHelp();
      }}
    >
      <CircleHelp size={16} aria-hidden="true" />
    </button>
  );
}

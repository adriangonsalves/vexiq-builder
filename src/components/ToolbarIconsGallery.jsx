// Only for checking the context bar icons by eye. Nothing imports it.
import {
  AddToSelectionIcon,
  MarkHoleIcon,
  JoinIcon,
  StampCopiesIcon,
  WorldArrowsIcon,
  FreeMoveIcon,
  TurnStepIcon,
  GrowSelectionIcon,
  OnePartOfGroupIcon,
  PinsOnlyIcon,
} from './toolbarIcons.jsx';

const ITEMS = [
  ['AddToSelectionIcon', (p) => <AddToSelectionIcon {...p} />],
  ['MarkHoleIcon', (p) => <MarkHoleIcon {...p} />],
  ['MarkHoleIcon set', (p) => <MarkHoleIcon set {...p} />],
  ['JoinIcon', (p) => <JoinIcon {...p} />],
  ['StampCopiesIcon', (p) => <StampCopiesIcon {...p} />],
  ['WorldArrowsIcon off', (p) => <WorldArrowsIcon {...p} />],
  ['WorldArrowsIcon on', (p) => <WorldArrowsIcon on {...p} />],
  ['FreeMoveIcon off', (p) => <FreeMoveIcon {...p} />],
  ['FreeMoveIcon on', (p) => <FreeMoveIcon on {...p} />],
  ['TurnStepIcon 15°', (p) => <TurnStepIcon value="15°" {...p} />],
  ['TurnStepIcon 45°', (p) => <TurnStepIcon value="45°" {...p} />],
  ['TurnStepIcon 90°', (p) => <TurnStepIcon value="90°" {...p} />],
  ['TurnStepIcon Free', (p) => <TurnStepIcon value="Free" {...p} />],
  ['GrowSelectionIcon', (p) => <GrowSelectionIcon {...p} />],
  ['OnePartOfGroupIcon', (p) => <OnePartOfGroupIcon {...p} />],
  ['PinsOnlyIcon', (p) => <PinsOnlyIcon {...p} />],
];

export default function ToolbarIconsGallery() {
  return (
    <div
      style={{
        background: '#0f172a',
        color: '#e2e8f0',
        padding: 16,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
      }}
    >
      {ITEMS.map(([name, render]) => (
        <div key={name} style={{ width: 140, textAlign: 'center' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', height: 40 }}>
            {render({ size: 20 })}
            {render({ size: 32 })}
          </div>
          <div style={{ marginTop: 6 }}>{name}</div>
        </div>
      ))}
    </div>
  );
}

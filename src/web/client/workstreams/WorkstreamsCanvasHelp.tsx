import type { WorkstreamView } from './WorkstreamsCanvas.tsx'

export function WorkstreamsCanvasHelp({ view }: { view: WorkstreamView }) {
  return (
    <>
      <strong>Move around the work</strong>
      <p>Scroll to pan. Pinch or Ctrl / ⌘ + scroll to zoom.</p>
      <p>
        <kbd>＋</kbd> / <kbd>−</kbd> Zoom
        <br />
        <kbd>Space</kbd> + drag Pan
        <br />
        <kbd>Shift 0</kbd> Actual size
        <br />
        <kbd>Shift 1</kbd> Fit all
        <br />
        <kbd>Shift 2</kbd> Fit selection
      </p>
      <p>
        {view === 'map'
          ? 'Drag a card to align its edges, center, or spacing with nearby workstreams. The magnet turns snapping on or off.'
          : 'Drag a lane heading vertically to reorder workstreams. Drag a dated activity horizontally to change its planned dates.'}
      </p>
      {view === 'map' && (
        <p>
          <kbd>Option / Alt</kbd> Move freely
          <br />
          <kbd>Shift</kbd> Keep a drag straight
          <br />
          <kbd>Esc</kbd> Cancel a drag
        </p>
      )}
      <p>
        Drag a card’s link handle to another workstream to relate them. Select a line to understand or edit the
        relationship. On touch, use the workstream’s three-dot menu.
      </p>
    </>
  )
}

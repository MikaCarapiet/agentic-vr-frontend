import { useFullscreen } from "./useFullscreen";
import "./navActions.css";

type Props = {
  compact?: boolean;
};

export default function FullscreenButton({ compact = false }: Props) {
  const { isFullscreen, toggleFullscreen } = useFullscreen();

  return (
    <button
      className={[
        "app-nav-btn",
        "app-nav-btn--icon",
        isFullscreen ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      type="button"
      onClick={toggleFullscreen}
      aria-pressed={isFullscreen}
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
    >
      <span className="app-nav-icon" aria-hidden="true">
        {isFullscreen ? (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        )}
      </span>
      {compact ? null : <span>{isFullscreen ? "Exit" : "Fullscreen"}</span>}
    </button>
  );
}

import FullscreenButton from "./FullscreenButton";
import "./navActions.css";

type Props = {
  onBrowseAll: () => void;
  onOpenAdmin: () => void;
  activePage?: "browse";
};

export default function TopNavActions({ onBrowseAll, onOpenAdmin, activePage }: Props) {
  return (
    <div className="app-nav-actions">
      <div className="app-nav-group" role="toolbar" aria-label="Page actions">
        <button className="app-nav-btn" type="button" onClick={onOpenAdmin}>
          Settings
        </button>
        {activePage === "browse" ? (
          <span className="app-nav-btn is-active" aria-current="page">
            Browse all
          </span>
        ) : (
          <button className="app-nav-btn" type="button" onClick={onBrowseAll}>
            Browse all
          </button>
        )}
        <FullscreenButton compact />
      </div>
    </div>
  );
}

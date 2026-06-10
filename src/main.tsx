import { createRoot, type Root as ReactRoot } from "react-dom/client";
import Root from "./App";

const rootElement = document.getElementById("root") as HTMLElement & {
  sceneVerseRoot?: ReactRoot;
};

rootElement.sceneVerseRoot ??= createRoot(rootElement);
rootElement.sceneVerseRoot.render(<Root />);

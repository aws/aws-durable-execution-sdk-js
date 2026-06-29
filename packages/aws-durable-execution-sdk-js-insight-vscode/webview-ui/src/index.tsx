import { createRoot } from "react-dom/client";
import "@cloudscape-design/global-styles/index.css";
import { App } from "./App";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

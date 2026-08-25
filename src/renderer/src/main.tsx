import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import App from "./App";
import "./styles/base.css";
import "./styles/results.css";
import "./styles/workspace.css";
import "./styles/responsive.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

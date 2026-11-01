import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n.js";
import App from "./App.jsx";
import "./index.css";
class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="empty-state">
        <h1>
          {document.documentElement.lang === "vi"
            ? "Không thể hiển thị ứng dụng"
            : "Could not display the app"}
        </h1>
        <button className="button" onClick={() => location.reload()}>
          {document.documentElement.lang === "vi" ? "Tải lại" : "Reload"}
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>,
);

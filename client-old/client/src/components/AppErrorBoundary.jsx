import { Component } from "react";

class AppErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("Application UI failed to render.", error?.name || "Error");
  }

  render() {
    if (this.state.hasError) {
      return <main className="app-error-boundary" role="alert" aria-labelledby="app-error-title">
        <section>
          <h1 id="app-error-title">This screen couldn’t load</h1>
          <p>A recent change may still be processing. Reload the page and check the record before trying that change again.</p>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </section>
      </main>;
    }
    return this.props.children;
  }
}

export default AppErrorBoundary;

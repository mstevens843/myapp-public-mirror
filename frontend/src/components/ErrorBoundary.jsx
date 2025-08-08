import React from 'react';

/**
 * A simple React error boundary to catch runtime errors in the component
 * tree and render a fallback UI instead of leaving the page blank.  This
 * prevents the dreaded white screen of death and gives users an actionable
 * message.  You can extend this component to report errors to a logging
 * service or display a more detailed message.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    // Update state so the next render shows the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // You could log the error to an error reporting service
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught an error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="p-4 text-center text-red-600">
          Something went wrong. Please refresh the page or try again later.
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
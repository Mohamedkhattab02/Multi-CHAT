'use client';

import React from 'react';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-[var(--destructive)]/10 flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-[var(--destructive)]" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-2">Something went wrong</h2>
          <p className="text-sm text-[var(--muted-foreground)] mb-4 max-w-sm">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg hover:opacity-90 transition-opacity"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            <RotateCcw className="w-4 h-4" />
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

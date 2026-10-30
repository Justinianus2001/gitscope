'use client';

import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type NotificationType = 'error' | 'warning' | 'info' | 'success';

export interface InlineNotificationProps {
  type?: NotificationType;
  title?: string;
  message: string;
  onDismiss?: () => void;
  className?: string;
}

const typeStyles: Record<
  NotificationType,
  {
    container: string;
    icon: React.ComponentType<{ className?: string }>;
    iconColor: string;
    titleColor: string;
    closeColor: string;
  }
> = {
  error: {
    container: 'border-rose-900/60 bg-rose-950/40 text-rose-200',
    icon: AlertCircle,
    iconColor: 'text-rose-400',
    titleColor: 'text-rose-100',
    closeColor: 'text-rose-400 hover:text-rose-200 hover:bg-rose-900/40',
  },
  warning: {
    container: 'border-amber-900/60 bg-amber-950/40 text-amber-200',
    icon: AlertTriangle,
    iconColor: 'text-amber-400',
    titleColor: 'text-amber-100',
    closeColor: 'text-amber-400 hover:text-amber-200 hover:bg-amber-900/40',
  },
  success: {
    container: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-200',
    icon: CheckCircle2,
    iconColor: 'text-emerald-400',
    titleColor: 'text-emerald-100',
    closeColor: 'text-emerald-400 hover:text-emerald-200 hover:bg-emerald-900/40',
  },
  info: {
    container: 'border-blue-900/60 bg-blue-950/40 text-blue-200',
    icon: Info,
    iconColor: 'text-blue-400',
    titleColor: 'text-blue-100',
    closeColor: 'text-blue-400 hover:text-blue-200 hover:bg-blue-900/40',
  },
};

export function InlineNotification({
  type = 'error',
  title,
  message,
  onDismiss,
  className = '',
}: InlineNotificationProps) {
  const styles = typeStyles[type];
  const Icon = styles.icon;

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className={`flex items-start gap-3 rounded-lg border p-3.5 text-xs shadow-sm transition-all ${styles.container} ${className}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${styles.iconColor}`} />

      <div className="flex-1 min-w-0 pr-1">
        {title && <h4 className={`font-semibold mb-0.5 ${styles.titleColor}`}>{title}</h4>}
        <p className="leading-relaxed break-words">{message}</p>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className={`-mr-1 -mt-1 shrink-0 rounded p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-neutral-950 ${styles.closeColor}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

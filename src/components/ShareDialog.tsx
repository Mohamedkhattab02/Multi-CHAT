'use client';

import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUiStore } from '@/lib/store/ui-store';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Link2, Copy, Check, Globe, Lock, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

export function ShareDialog() {
  const { isShareDialogOpen, shareConversationId, setShareDialogOpen } = useUiStore();
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load current share state when dialog opens
  useEffect(() => {
    if (!isShareDialogOpen || !shareConversationId) return;

    async function loadShareState() {
      const supabase = createClient();
      const { data } = await supabase
        .from('conversations')
        .select('share_token, is_public')
        .eq('id', shareConversationId!)
        .single();

      if (data) {
        setShareToken(data.share_token);
        setIsPublic(data.is_public);
      }
    }
    loadShareState();
  }, [isShareDialogOpen, shareConversationId]);

  const generateShareLink = useCallback(async () => {
    if (!shareConversationId) return;
    setLoading(true);

    const supabase = createClient();
    const token = crypto.randomUUID();

    const { error } = await supabase
      .from('conversations')
      .update({ share_token: token, is_public: true })
      .eq('id', shareConversationId);

    if (error) {
      toast.error('Failed to generate share link');
    } else {
      setShareToken(token);
      setIsPublic(true);
      toast.success('Share link generated');
    }
    setLoading(false);
  }, [shareConversationId]);

  const revokeShareLink = useCallback(async () => {
    if (!shareConversationId) return;
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase
      .from('conversations')
      .update({ share_token: null, is_public: false })
      .eq('id', shareConversationId);

    if (error) {
      toast.error('Failed to revoke share link');
    } else {
      setShareToken(null);
      setIsPublic(false);
      toast.success('Share link revoked');
    }
    setLoading(false);
  }, [shareConversationId]);

  const copyLink = useCallback(() => {
    if (!shareToken) return;
    const url = `${window.location.origin}/shared/${shareToken}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Link copied to clipboard');
  }, [shareToken]);

  const close = () => {
    setShareDialogOpen(false);
    setShareToken(null);
    setIsPublic(false);
    setCopied(false);
  };

  return (
    <AnimatePresence>
      {isShareDialogOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={close}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md z-50"
          >
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  Share conversation
                </h2>
                <button
                  onClick={close}
                  className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4 text-[var(--muted-foreground)]" />
                </button>
              </div>

              {/* Status */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--secondary)] mb-4">
                {isPublic ? (
                  <>
                    <Globe className="w-5 h-5 text-[var(--success)]" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[var(--foreground)]">Public link active</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Anyone with the link can view this conversation
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Lock className="w-5 h-5 text-[var(--muted-foreground)]" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[var(--foreground)]">Private</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Only you can see this conversation
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Share link */}
              {shareToken && (
                <div className="flex items-center gap-2 p-2 rounded-lg border border-[var(--border)] mb-4">
                  <Link2 className="w-4 h-4 text-[var(--muted-foreground)] flex-shrink-0" />
                  <span className="flex-1 text-xs text-[var(--muted-foreground)] truncate font-mono">
                    {window.location.origin}/shared/{shareToken}
                  </span>
                  <button
                    onClick={copyLink}
                    className="p-1.5 rounded-md hover:bg-[var(--secondary)] transition-colors cursor-pointer"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-[var(--success)]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                    )}
                  </button>
                  <a
                    href={`/shared/${shareToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-md hover:bg-[var(--secondary)] transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                  </a>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                {!isPublic ? (
                  <button
                    onClick={generateShareLink}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    <Link2 className="w-4 h-4" />
                    {loading ? 'Generating...' : 'Generate share link'}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={copyLink}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      <Copy className="w-4 h-4" />
                      Copy link
                    </button>
                    <button
                      onClick={revokeShareLink}
                      disabled={loading}
                      className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-[var(--destructive)] text-[var(--destructive)] text-sm font-medium hover:bg-[var(--destructive)]/10 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {loading ? 'Revoking...' : 'Revoke'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

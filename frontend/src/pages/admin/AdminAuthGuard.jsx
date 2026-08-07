/**
 * AdminAuthGuard — Entra ID (MSAL) edition.
 *
 * The Firebase version carried ~200 lines of Google-popup fallback logic and
 * a hand-rolled phone-MFA + reCAPTCHA flow. None of that has an equivalent
 * here on purpose: MSAL owns popup-vs-redirect recovery, and MFA is an Entra
 * Conditional Access policy enforced inside the Microsoft sign-in — the SPA
 * never sees a second factor.
 *
 * The bootstrap path is unchanged in spirit: a signed-in non-admin can
 * attempt bootstrapCurrentUserAdmin; the server's three-way gate (allowlist /
 * super_admin / locked) decides, and a denial hides the button.
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ShieldAlert, LogIn } from 'lucide-react';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { postJSON } from '@/lib/api';
import { signIn, signOutUser } from '@/lib/entraAuth';

export default function AdminAuthGuard({ children }) {
  const { authReady, isAdmin, isLoading: adminStatusLoading, user } = useAdminAuth();
  const [error, setError] = useState(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [bootstrapMessage, setBootstrapMessage] = useState('');
  // Once the server rejects a bootstrap attempt (admins already exist / not
  // on the allowlist), hide the button — it cannot succeed for this user.
  const [bootstrapDenied, setBootstrapDenied] = useState(false);

  const handleSignIn = async () => {
    try {
      setError(null);
      await signIn(); // popup, falling back to redirect internally
    } catch (err) {
      setError(err?.message || 'Unable to sign in.');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
    } catch (err) {
      console.error('Sign out failed:', err);
    }
  };

  const handleBootstrapSelf = async () => {
    setBootstrapLoading(true);
    setError(null);
    setBootstrapMessage('');
    try {
      const result = await postJSON('bootstrapCurrentUserAdmin', { role: 'super_admin' });
      setBootstrapMessage(
        result?.initialBootstrap
          ? 'Initial admin bootstrap completed. Refreshing session...'
          : 'Role updated successfully. Refreshing session...'
      );
      // The backend cleared its role cache; a reload re-runs the status check.
      setTimeout(() => {
        window.location.reload();
      }, 600);
    } catch (err) {
      setBootstrapDenied(true);
      setBootstrapMessage(err.message || 'Unable to bootstrap admin access.');
    } finally {
      setBootstrapLoading(false);
    }
  };

  if (!authReady || (user && adminStatusLoading)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-slate-blue" />
      </div>
    );
  }

  // Not signed in
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <ShieldAlert className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
            <CardTitle>Admin Access Required</CardTitle>
            <CardDescription>
              Sign in with your Microsoft account to access the CMS.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <Button onClick={handleSignIn} className="gap-2">
              <LogIn className="h-4 w-4" />
              Sign in with Microsoft
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Signed in but not admin
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <ShieldAlert className="h-12 w-12 mx-auto text-destructive mb-2" />
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              {user.email} is not authorized. Contact the site admin.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              {!bootstrapDenied && (
                <Button
                  variant="secondary"
                  onClick={handleBootstrapSelf}
                  disabled={bootstrapLoading}
                >
                  {bootstrapLoading ? 'Provisioning admin access...' : 'Bootstrap My Admin Access'}
                </Button>
              )}
              <Button variant="outline" onClick={handleSignOut}>
                Sign out
              </Button>
              {bootstrapMessage && (
                <p className="text-xs text-muted-foreground">{bootstrapMessage}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Authorized admin
  return children;
}

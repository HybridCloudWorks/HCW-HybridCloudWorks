/**
 * AdminAuthGuard — Entra ID (MSAL) edition.
 *
 * The previous auth implementation carried ~200 lines of Google-popup fallback logic and
 * a hand-rolled phone-MFA + reCAPTCHA flow. None of that has an equivalent
 * here on purpose: MSAL owns popup-vs-redirect recovery, and MFA is an Entra
 * Conditional Access policy enforced inside the Microsoft sign-in — the SPA
 * never sees a second factor.
 *
 * THREE OUTCOMES, THREE SCREENS (#503). `useAdminAuth` reports `authorized`,
 * `unauthorized` or `unknown`, and only the middle one is a refusal. An
 * expired token, a rejected token or an unreachable API is `unknown` — a check
 * that could not run — and rendering that as "Access Denied … not authorized"
 * told the owner, whose `admins` record was fine, that he had lost access and
 * offered to re-provision him. Keep the three apart.
 *
 * The bootstrap path is unchanged in spirit but no longer guessed at: the
 * server's three-way gate (allowlist / super_admin / locked) is reported as
 * `canBootstrap` on the status answer, so the button appears only when
 * pressing it could succeed, and never for an account that already has a row
 * in `admins`.
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ShieldAlert, ShieldQuestion, LogIn, RefreshCw } from 'lucide-react';
import { useAdminAuth, ACCESS_STATE, UNKNOWN_REASON } from '@/hooks/useAdminAuth';
import { postJSON } from '@/lib/api';
import { signIn, signOutUser, reauthenticateForApi } from '@/lib/entraAuth';

export default function AdminAuthGuard({ children }) {
  const {
    authReady,
    isAdmin,
    isLoading: adminStatusLoading,
    user,
    adminStatus,
    accessState,
    unknownReason,
    error: accessError,
    recheck,
  } = useAdminAuth();
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

  const handleReauthenticate = async () => {
    try {
      setError(null);
      await reauthenticateForApi(); // redirect; the page navigates away
    } catch (err) {
      setError(err?.message || 'Unable to renew your session.');
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

  // Signed in, but the check could not run. NOT a denial, and deliberately
  // says nothing about whether this account is an admin — because nobody
  // knows. The hook has already spent its one automatic re-authentication by
  // the time this renders, so the recovery here is a button.
  if (accessState === ACCESS_STATE.UNKNOWN) {
    const isSession = unknownReason === UNKNOWN_REASON.SESSION;
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <ShieldQuestion className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
            <CardTitle>Could not verify your access</CardTitle>
            <CardDescription>
              {isSession
                ? 'Your sign-in needs renewing before we can check your admin access.'
                : 'The admin service did not answer, so your access could not be checked. This is not a refusal.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              {isSession ? (
                <Button onClick={handleReauthenticate} className="gap-2">
                  <LogIn className="h-4 w-4" />
                  Sign in again
                </Button>
              ) : (
                <Button onClick={recheck} disabled={adminStatusLoading} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  {adminStatusLoading ? 'Checking...' : 'Try again'}
                </Button>
              )}
              <Button variant="outline" onClick={handleSignOut}>
                Sign out
              </Button>
              {(error || accessError) && (
                <p className="text-xs text-muted-foreground">{error || accessError}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Signed in, checked, and genuinely not an admin.
  if (!isAdmin) {
    // Only the server knows whether bootstrapping would work, and it says so
    // on the status answer. Guessing "offer it and let the POST decide" is
    // what put the button in front of an owner who already held the record.
    const canBootstrap = adminStatus?.canBootstrap === true && !bootstrapDenied;
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
              {canBootstrap && (
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

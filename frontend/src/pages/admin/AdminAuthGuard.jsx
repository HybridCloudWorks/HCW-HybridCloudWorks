import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
  getMultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
} from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ShieldAlert, LogIn } from 'lucide-react';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { postJSON } from '@/lib/api';
import { app } from '@/lib/firebaseConfig';

export default function AdminAuthGuard({ children }) {
  const { authReady, isAdmin, isLoading: adminStatusLoading, user } = useAdminAuth();
  const [error, setError] = useState(null);
  const [mfaResolver, setMfaResolver] = useState(null);
  const [mfaHintLabel, setMfaHintLabel] = useState('');
  const [mfaVerificationId, setMfaVerificationId] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSending, setMfaSending] = useState(false);
  const [mfaVerifying, setMfaVerifying] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [bootstrapMessage, setBootstrapMessage] = useState('');
  // Once the server rejects a bootstrap attempt (admins already exist / not on the
  // allowlist), hide the button — it cannot succeed for this user.
  const [bootstrapDenied, setBootstrapDenied] = useState(false);
  const recaptchaRef = useRef(null);

  const shouldUseRedirectFallback = (code) =>
    code === 'auth/popup-blocked' ||
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/internal-error';

  const resetMfaState = () => {
    setMfaResolver(null);
    setMfaHintLabel('');
    setMfaVerificationId('');
    setMfaCode('');
    setMfaSending(false);
    setMfaVerifying(false);
  };

  const ensureRecaptchaVerifier = useCallback((auth) => {
    if (recaptchaRef.current) {
      return recaptchaRef.current;
    }

    recaptchaRef.current = new RecaptchaVerifier(auth, 'admin-mfa-recaptcha', {
      size: 'invisible',
    });

    return recaptchaRef.current;
  }, []);

  const startMfaChallenge = useCallback(
    async (authErrorOrResolver) => {
      try {
        setError(null);
        setMfaSending(true);

        const auth = getAuth(app);
        const resolver =
          authErrorOrResolver?.session && Array.isArray(authErrorOrResolver?.hints)
            ? authErrorOrResolver
            : getMultiFactorResolver(auth, authErrorOrResolver);
        const hint =
          resolver.hints.find(
            (factorHint) => factorHint.factorId === PhoneMultiFactorGenerator.FACTOR_ID
          ) || resolver.hints[0];

        if (!hint) {
          setError(
            'MFA is enabled, but no enrolled second-factor method was found for this account.'
          );
          setMfaSending(false);
          return;
        }

        const recaptchaVerifier = ensureRecaptchaVerifier(auth);
        const phoneProvider = new PhoneAuthProvider(auth);
        const verificationId = await phoneProvider.verifyPhoneNumber(
          {
            multiFactorHint: hint,
            session: resolver.session,
          },
          recaptchaVerifier
        );

        setMfaResolver(resolver);
        setMfaHintLabel(hint.displayName || hint.phoneNumber || 'your registered phone');
        setMfaVerificationId(verificationId);
        setMfaCode('');
      } catch (challengeError) {
        setError(challengeError?.message || 'Unable to start MFA challenge.');
      } finally {
        setMfaSending(false);
      }
    },
    [ensureRecaptchaVerifier]
  );

  const handleMfaVerify = async () => {
    if (!mfaResolver || !mfaVerificationId || !mfaCode) {
      setError('Enter the SMS verification code to continue.');
      return;
    }

    try {
      setError(null);
      setMfaVerifying(true);

      const phoneCredential = PhoneAuthProvider.credential(mfaVerificationId, mfaCode);
      const multiFactorAssertion = PhoneMultiFactorGenerator.assertion(phoneCredential);
      const userCredential = await mfaResolver.resolveSignIn(multiFactorAssertion);
      await userCredential.user.getIdToken(true);
      resetMfaState();
    } catch (verifyError) {
      setError(verifyError?.message || 'Invalid code. Please try again.');
    } finally {
      setMfaVerifying(false);
    }
  };

  useEffect(() => {
    const auth = getAuth(app);

    const REDIRECT_FLAG = 'hcw_auth_redirect_in_progress';

    getRedirectResult(auth)
      .then(async (result) => {
        // Clear any redirect flag set prior to redirect-based sign-in
        try {
          localStorage.removeItem(REDIRECT_FLAG);
        } catch {
          /* ignore */
        }

        if (result?.user) {
          await result.user.getIdToken(true);
        }
      })
      .catch((err) => {
        const code = err?.code || '';

        // If redirect flow was started but initial state is missing, inform the user
        try {
          if (localStorage.getItem(REDIRECT_FLAG)) {
            localStorage.removeItem(REDIRECT_FLAG);
            setError(
              'Sign-in state was lost during redirect. Please retry sign-in in a single tab (avoid storage-partitioned or strict privacy modes).'
            );
            return;
          }
        } catch {
          // ignore storage access errors
        }

        if (code === 'auth/multi-factor-auth-required') {
          startMfaChallenge(err);
          return;
        }
        if (code === 'auth/internal-error') {
          setError(
            'Google sign-in hit a browser auth error. Retry in a single normal browser window, or use the redirect flow if a popup did not complete.'
          );
          return;
        }
        if (code) {
          setError(err.message || 'Google sign-in failed.');
        }
      });

    return () => {
      if (recaptchaRef.current) {
        recaptchaRef.current.clear();
        recaptchaRef.current = null;
      }
    };
  }, [startMfaChallenge]);

  const handleSignIn = async () => {
    try {
      setError(null);
      const auth = getAuth(app);
      const provider = new GoogleAuthProvider();

      // prefer persistent storage for redirect flows so state survives tab reloads
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch {
        // ignore persistence errors and continue
      }

      // Try popup first, fall back to redirect when popup fails (blocked or closed)
      try {
        const credential = await signInWithPopup(auth, provider);
        await credential.user.getIdToken(true);
        return;
      } catch (popupErr) {
        const popupCode = popupErr?.code || '';
        if (shouldUseRedirectFallback(popupCode)) {
          // mark that a redirect flow is in progress so we can detect lost state
          try {
            localStorage.setItem('hcw_auth_redirect_in_progress', '1');
          } catch {
            // ignore storage errors
          }
          await signInWithRedirect(auth, provider);
          return;
        }
        // If popup failed for other reasons, rethrow to outer catch
        throw popupErr;
      }
    } catch (err) {
      const code = err?.code || '';
      const auth = getAuth(app);
      const provider = new GoogleAuthProvider();

      if (shouldUseRedirectFallback(code)) {
        // signInWithRedirect fallback handled above; if we hit this point, try redirect
        try {
          localStorage.setItem('hcw_auth_redirect_in_progress', '1');
        } catch {}
        await signInWithRedirect(auth, provider);
        return;
      }

      if (code === 'auth/multi-factor-auth-required') {
        await startMfaChallenge(err);
        return;
      }

      setError(err.message || 'Unable to sign in.');
    }
  };

  const handleSignOut = async () => {
    try {
      await getAuth(app).signOut();
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
      const auth = getAuth(app);
      await auth.currentUser?.getIdToken(true);
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
            <CardDescription>Sign in with your Google account to access the CMS.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <Button onClick={handleSignIn} className="gap-2">
              <LogIn className="h-4 w-4" />
              Sign in with Google
            </Button>
            {(mfaSending || mfaVerificationId) && (
              <p className="text-xs text-muted-foreground text-center">
                Security check active: Firebase reCAPTCHA is being used for this MFA verification.
              </p>
            )}
            {mfaVerificationId && (
              <div className="w-full space-y-3">
                <p className="text-xs text-muted-foreground text-center">
                  Enter the verification code sent to {mfaHintLabel}.
                </p>
                <Input
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.trim())}
                  placeholder="6-digit code"
                  inputMode="numeric"
                />
                <div className="flex items-center justify-center gap-2">
                  <Button onClick={handleMfaVerify} disabled={mfaVerifying || !mfaCode}>
                    {mfaVerifying ? 'Verifying...' : 'Verify code'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => mfaResolver && startMfaChallenge(mfaResolver)}
                    disabled={mfaSending || mfaVerifying || !mfaResolver}
                  >
                    {mfaSending ? 'Sending...' : 'Resend code'}
                  </Button>
                </div>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div id="admin-mfa-recaptcha" />
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

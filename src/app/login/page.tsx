"use client";
import { useActionState } from "react";
import { Layers, ArrowRight, ShieldCheck, LoaderCircle } from "lucide-react";
import { loginAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
export default function Login() {
  const [state, action, pending] = useActionState(loginAction, {
    ok: false,
    message: "",
  });
  return (
    <main className="login" id="main-content">
      <section className="login-story" aria-label="Workwear manufacturing workspace">
        <div className="brand">
          <Layers size={32} aria-hidden="true" /> workwear
        </div>
        <div>
          <p className="eyebrow">WORKWEAR / OPERATIONS PLATFORM</p>
          <h1>
            Precision in
            <br />
            every thread.
          </h1>
          <p>
            From material receipt to the final delivery.
            <br />
            One connected manufacturing workspace.
          </p>
        </div>
        <div className="login-system-meta"><span>PLAN / PRODUCE / DELIVER</span><span>Workwear ERP</span></div>
      </section>
      <section className="login-form" aria-labelledby="login-title">
        <div>
          <span className="login-mark">
            <ShieldCheck size={28} aria-hidden="true" />
          </span>
          <p className="eyebrow">YOUR WORKSPACE AWAITS</p>
          <h2 id="login-title">Welcome back.</h2>
          <p className="muted">Sign in to keep your operations moving.</p>
          <form action={action} aria-busy={pending} aria-describedby="login-help">
            <label className="field">
              <span>Email address</span>
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                disabled={pending}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={pending}
              />
            </label>
            {state.message && (
              <p className="error" role="alert">
                {state.message}
              </p>
            )}
            <Button disabled={pending} type="submit">
              {pending && <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />}
              {pending ? "Signing in…" : "Sign in to workspace"}
              {!pending && <ArrowRight size={17} aria-hidden="true" />}
            </Button>
          </form>
          <p className="login-help" id="login-help">
            Access is managed by your administrator.
            <br />
            Contact your team administrator if you need help signing in.
          </p>
        </div>
      </section>
    </main>
  );
}

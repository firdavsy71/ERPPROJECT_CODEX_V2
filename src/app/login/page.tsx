"use client";
import { useActionState } from "react";
import { Layers, ArrowRight, ShieldCheck } from "lucide-react";
import { loginAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
export default function Login() {
  const [state, action, pending] = useActionState(loginAction, {
    ok: false,
    message: "",
  });
  return (
    <main className="login">
      <section className="login-story">
        <div className="brand">
          <Layers size={32} /> workwear
        </div>
        <div>
          <p className="eyebrow">FROM FIRST THREAD TO FINAL DELIVERY</p>
          <h1>
            Good work.
            <br />
            All connected.
          </h1>
          <p>
            Your people, production, and inventory.
            <br />
            One clear picture of your business.
          </p>
        </div>
        <span>Workwear ERP / Manufacturing operations</span>
      </section>
      <section className="login-form">
        <div>
          <span className="login-mark">
            <ShieldCheck size={28} />
          </span>
          <p className="eyebrow">YOUR WORKSPACE AWAITS</p>
          <h2>Welcome back.</h2>
          <p className="muted">Sign in to keep your operations moving.</p>
          <form action={action}>
            <label className="field">
              <span>Email address</span>
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            {state.message && (
              <p className="error" role="alert">
                {state.message}
              </p>
            )}
            <Button disabled={pending}>
              {pending ? "Signing in…" : "Sign in to workspace"}
              <ArrowRight size={17} />
            </Button>
          </form>
          <p className="login-help">
            Access is managed by your administrator.
            <br />
            Local setup credentials are stored in .env.local.
          </p>
        </div>
      </section>
    </main>
  );
}

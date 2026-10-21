import { CompanyDashboard } from './CompanyDashboard'

/**
 * WHAT LANDS ON "/" — AND IT IS THE SAME SCREEN FOR EVERYBODY NOW.
 *
 * THE FIRM DECIDED THIS, in those words: "it's important for everybody in the company to
 * understand that we are a collective. So it's important to go into the company dashboard as the
 * first thing that you see. And then you should go to your own stuff."
 *
 * WHAT THIS FILE USED TO DO, and why it no longer does it, is worth keeping. It sent an
 * Administrator to the admin overview, a Communications team to theirs, the two pre-legal roles
 * to the collections floor and EVERYBODY ELSE to the sales dashboard — so where you landed was
 * an accident of your role, a sales rep and a collector had no screen in common, and nobody
 * could see what the rest of the firm was doing. Landing everyone on one screen is not a
 * simplification of that rule; it is the opposite decision, and the firm's.
 *
 * THE ROLE STILL DECIDES SOMETHING — just not this. It decides where "Go to my dashboard" goes,
 * and that lives in DEPARTMENT_DASHBOARD in src/lib/departments.ts, beside the department it is
 * derived from rather than in a second list here. This component is a seam kept deliberately:
 * one route, one place to change if the firm ever wants a department to open somewhere else.
 */
export function DashboardRouter() {
  return <CompanyDashboard />
}

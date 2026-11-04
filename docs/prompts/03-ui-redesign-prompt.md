# Prompt 03 — UI redesign (verbatim)

Given after Phase 7, 2026-11-04.

---

# Claude Code Prompt — Professional UI Redesign for Multi-Tenant Security POC

Act as a senior frontend engineer and SaaS product designer.

I already have a working multi-tenant security POC built using NestJS and PostgreSQL Row-Level Security (RLS).

The current frontend is functional but looks unprofessional and basic. I have provided a screenshot of the existing application.

Your task is to redesign the frontend into a polished, modern, professional SaaS security demonstration dashboard.

## Important: Preserve Existing Functionality

Before making changes, inspect the existing frontend code.

This is a UI redesign task only.

Do not modify:
- NestJS backend APIs
- PostgreSQL database
- RLS policies
- Authentication logic
- JWT generation or validation
- Tenant isolation logic
- Database transaction handling
- API request behavior
- Existing security tests

Keep all existing API endpoints, request payloads, authentication headers, and response handling unchanged.

Do not replace real backend integration with mock data.

## Design Direction

Create a modern enterprise healthcare SaaS dashboard with a professional security-focused appearance.

Use:
- Primary color: Deep navy blue
- Accent color: Healthcare blue
- Background: Very light blue-gray
- Cards: White with subtle borders and shadows
- Typography: Inter or a similar clean sans-serif font
- Rounded corners: 12–16px
- Consistent spacing and alignment
- Subtle transitions and hover effects

Avoid:
- Excessive gradients
- Bright neon colors
- Oversized headings
- Unnecessary animations
- Basic browser-style forms
- Excessive empty space
- Overly decorative elements

The interface should look suitable for a client demonstration.

## Page Layout

Create a professional dashboard layout.

### 1. Header

Add a clean top navigation bar containing:

- Product name: TenantGuard
- Subtitle: Multi-Tenant Security Demonstration
- PostgreSQL RLS status indicator
- API connection status
- Current authenticated tenant indicator
- Logout action

The authenticated tenant indicator must reflect the actual logged-in user.

Do not display a tenant as authenticated when no valid token exists.

### 2. Main Dashboard

Use a centered dashboard container with a responsive layout.

At the top, display:

**Tenant Isolation Overview**

Show three compact status cards:

- Active Tenant
- Database Security: Row-Level Security
- Connection Pool: Transaction-Scoped Context

These cards must display only accurate information based on the existing implementation.

Do not falsely display a successful security status if it has not been verified.

### 3. Authentication Card

Redesign the existing login section.

Include:

- Clear heading: Authenticate Tenant
- User selection dropdown
- Password input with show/hide option
- Primary Login button
- Logout button
- Authentication status badge
- Helpful error and success messages

Use proper labels, spacing, and accessible controls.

The dropdown must use the existing user options.

Do not expose passwords or tokens in the UI.

### 4. API Security Testing Console

Create a visually organized section titled:

**Tenant Isolation Test Console**

Add three clearly separated test actions:

1. Load My Patients
2. Attempt Cross-Tenant Access
3. Request Without Authentication

Use visually distinct buttons and icons.

Each action must call the existing backend endpoint and preserve its current behavior.

For the cross-tenant test, retain the existing security logic. Do not weaken authentication or allow arbitrary tenant switching.

### 5. API Response Panel

Replace the plain response output with a professional API response viewer.

Display:

- HTTP status code
- Request endpoint
- Request authentication status
- Human-readable result message
- Formatted JSON response
- Expand/collapse raw response functionality

Use status colors:

- Green for successful requests
- Red for rejected or failed requests
- Amber for warnings

Make the JSON output readable using a monospace font and a dark code panel.

The existing raw response must remain accessible.

### 6. Security Demonstration Feedback

Show understandable messages for each security scenario.

Examples:

Successful tenant-specific request:
"Request completed. Only records belonging to the authenticated tenant were returned."

Cross-tenant access rejected:
"Access denied. The authenticated tenant cannot access another tenant's records."

Missing authentication:
"Request rejected. No valid authentication token was provided."

These messages must be based on actual API responses, not hardcoded success states.

### 7. Responsive Design

The application must work well on:

- Desktop
- Laptop
- Tablet
- Mobile

On desktop, use a balanced dashboard layout with appropriate spacing.

On mobile, stack cards and controls vertically.

Avoid horizontal overflow.

### 8. Technical Requirements

- Continue using the existing frontend framework and libraries.
- Reuse existing components where appropriate.
- Use reusable components for status cards, buttons, response panels, and form controls.
- Maintain the existing API integration.
- Keep TypeScript types correct.
- Avoid unnecessary dependencies.
- Do not introduce a new frontend framework.
- Do not change the backend.
- Do not remove any existing functionality.

## Final Validation

After implementing the redesign:

1. Run the frontend.
2. Verify the login flow.
3. Verify Load My Patients.
4. Verify cross-tenant access testing.
5. Verify unauthenticated requests.
6. Verify API responses and error states.
7. Verify logout.
8. Check responsive behavior.
9. Confirm the backend and security tests remain unchanged.

The final result should look like a polished enterprise SaaS security dashboard suitable for a client presentation.

First inspect the existing frontend and identify the components and styling system. Then implement the redesign without changing the underlying functionality.

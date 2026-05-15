# Crimson Velocity Design System

### 1. Overview & Creative North Star
**Creative North Star: The Precision Engine.**
Crimson Velocity is a high-performance design system built for speed, administrative clarity, and structural authority. It rejects the soft, floating "cloud-like" aesthetics of generic SaaS for a look that is grounded, high-contrast, and editorial. It draws inspiration from automotive dashboards—where every indicator has a purpose and the most critical data is highlighted with visceral urgency. By utilizing deep blacks against clinical whites and piercing reds, the system creates a sense of focused professional energy.

### 2. Colors
The palette is dominated by three pillars: **Pure White**, **Ink Black**, and **Velocity Red**.
- **Primary Role:** `#ff0008` (Velocity Red) is reserved for brand identification, high-priority actions, and status indicators. It is never used for decoration.
- **The "No-Line" Rule:** Direct borders between large layout blocks are prohibited. Instead, the transition from the sidebar (`#1a1a1a`) to the workspace (`#f8f5f5`) defines the primary structural boundary. Sectioning within cards should be achieved by shifting from `surface` to `surface_container`.
- **Surface Hierarchy:** 
    - **Base Layer:** `#f8f5f5` (Background)
    - **Component Layer:** `#ffffff` (Surface)
    - **Sub-Section Layer:** `#f1f1f1` (Surface Container)
- **Glass & Gradient:** Floating menus and mobile headers should use a 15% backdrop blur with a 90% opacity surface fill to maintain context of the underlying data.

### 3. Typography
The system uses **Inter** exclusively to lean into its geometric, highly legible technicality.
- **Display Scale:** Use the 1.875rem (30px) "Black" weight for page titles to create an editorial anchor.
- **Headline Scale:** 1.5rem and 1.25rem are utilized for major section breaks and card headers, emphasizing a strong "Black" or "Bold" weight (700-900).
- **Body & Labels:** 1rem is the standard for data entry, while 0.875rem and 0.75rem are used for metadata and secondary labels to maximize information density without sacrificing clarity.
- **Rhythm:** The scale follows a strict 0.875rem -> 1rem -> 1.25rem progression, ensuring that even dense data tables remain readable.

### 4. Elevation & Depth
Elevation is communicated through **Tonal Stacking** and high-contrast shadows rather than heavy outlines.
- **The Layering Principle:** Cards utilize a `shadow-sm` on a white background. Active sidebar elements use a `shadow-lg` with a tinted shadow color (`shadow-primary/20`) to appear as if they are illuminated from beneath.
- **Shadow Ground Truth:**
    - **Standard Depth:** Small, tight shadows for subtle separation from the background.
    - **Active Depth:** Large, diffused shadows (Blur: 15-20px) with low opacity (0.1 - 0.2) to signify focus or interaction.
- **Accent Elevation:** Every primary card features a 4px solid top-border in Velocity Red, creating a "top-down" hierarchy that directs the eye immediately to the content below.

### 5. Components
- **Buttons:** Primary buttons are solid Velocity Red with rounded-lg (0.5rem) corners. Secondary buttons use a white-to-f1f1f1 transition with a subtle outline-variant border.
- **Data Tables:** Tables must use `#f1f1f1` (Surface Container) for headers to separate them from the record rows. Hover states on rows use a subtle background shift rather than a border change.
- **Status Chips:** Use high-contrast, low-saturation backgrounds (e.g., Green-100/Yellow-100) with deep-tone text for maximum accessibility.
- **Sidebar Nav:** High-contrast dark mode is mandatory for sidebars to provide a permanent anchor for the user’s cognitive map.

### 6. Do's and Don'ts
- **Do:** Use 4px accent strips for card headers to denote importance.
- **Do:** Use 1.875rem Bold text for primary dashboard KPIs.
- **Don't:** Use 1px borders to separate table rows; use tonal shifts or white space.
- **Don't:** Use Velocity Red for secondary or tertiary actions—keep it as a "high-alert" color.
- **Do:** Maintain a 32px (md:p-8) padding rhythm for main content areas to give data room to breathe.
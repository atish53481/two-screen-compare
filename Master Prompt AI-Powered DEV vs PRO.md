Master Prompt: AI-Powered **DEV** vs **PRODUCTION** Application Comparison & QA Automation Platform ## Project Objective

Act as a Senior Full-Stack Developer, QA Automation Architect, Playwright Expert, and AI Agent Engineer.

I want you to design and develop a complete web-based application called:

AI-Powered Environment Comparison & QA Automation Platform

The primary purpose of this application is to compare two environments of the same application:

**DEV** Environment **PRODUCTION** Environment

The application should automatically replicate every user interaction performed in **DEV** onto **PRODUCTION** and continuously compare both environments to identify differences.

The goal is to identify functional, UI, visual, content, validation, data, and **CSS** mismatches between **DEV** and **PRODUCTION**.

This should be a fully functional application, not just a prototype or UI mockup.

## Application Configuration

Create a dashboard where the QA engineer can configure two application URLs.

Example:

**DEV** **URL**: [https://dev.example.com](https://dev.example.com)

**PRODUCTION** **URL**: [https://[www.example.com](https://www.example.com](https://www.example.com](https://www.example.com))

Allow the QA engineer to:

Enter the **DEV** **URL**. Enter the **PRODUCTION** **URL**. Save the application configuration. Give the application a project name. Configure authentication credentials or approved test-account login flows. Configure viewport dimensions. Configure comparison settings. Start and stop a comparison session.

After configuration, display both applications side by side in the same dashboard.

## Side-by-Side Browser Execution

This is the most important functionality.

Open two independent browser sessions:

**LEFT** **SIDE**: **DEV** **APPLICATION**

**RIGHT** **SIDE**: **PRODUCTION** **APPLICATION**

Use Playwright to control both browser sessions.

When the QA engineer performs an action in the **DEV** application, the same action should automatically execute in **PRODUCTION**.

Examples:

Mouse click Double click Mouse hover Text entry Dropdown selection Checkbox selection Radio button selection Scrolling Form submission Navigation Tab switching Pagination Link clicking Keyboard actions Modal opening and closing

The action performed in **DEV** should be replicated in **PRODUCTION** using appropriate element identification and locator strategies.

Do not simply copy mouse coordinates. Use **DOM**-based selectors, accessible roles, labels, text, and stable attributes wherever possible.

If an equivalent element cannot be found in **PRODUCTION**, log it as a mismatch.

## Intelligent Interaction Synchronization

Build an interaction synchronization engine.

For every action performed in **DEV**:

Capture the user action. Identify the target element. Capture its selector and relevant attributes. Identify the equivalent element in **PRODUCTION**. Execute the same action in **PRODUCTION**. Wait for both environments to reach a stable state. Capture screenshots. Compare the resulting screens. Record any differences. Display the comparison results.

Maintain synchronization between both browser sessions.

For example:

If I click the Login button in **DEV**, the Login button in **PRODUCTION** should also be clicked.

If I navigate to the Dashboard in **DEV**, **PRODUCTION** should navigate to its corresponding Dashboard.

If I open Page 2 in **DEV**, **PRODUCTION** should also navigate to Page 2.

If I enter a value in a **DEV** form field, enter the corresponding value in the equivalent **PRODUCTION** field.

Support configurable synchronization timeouts and retries.

## UI and Visual Comparison Engine

Develop a powerful visual comparison engine.

Compare the following:

- Layout and Alignment
Element positioning
Horizontal alignment
Vertical alignment
Padding
Margin
Container dimensions
Element height and width
Grid and flex layouts
Spacing differences
Responsive layout differences
- Fonts and Typography
Font family
Font size
Font weight
Font color
Line height
Letter spacing
Text alignment
Text decoration
- **CSS** Comparison
Background colors
Border colors
Border widths
Border radius
Box shadows
Opacity
Display properties
Visibility
Positioning
Overflow
Z-index
Computed **CSS** properties
- Content Comparison
Page headings
Labels
Placeholder text
Button text
Paragraphs
Table headers
Table values
Dropdown options
Error messages
Success messages
Tooltip text
Notifications
Dynamic content
- Component Comparison
Buttons
Input fields
Dropdowns
Checkboxes
Radio buttons
Tables
Cards
Navigation menus
Headers
Footers
Modals
Popups
Pagination
Tabs

Identify missing, extra, modified, or incorrectly positioned elements.

## Functional and Validation Comparison

The system should verify whether application functionality behaves consistently across **DEV** and **PRODUCTION**.

Examples:

Login functionality Logout functionality Required-field validation Email validation Password validation Form submission Dropdown behavior Button functionality Navigation behavior **API** error messages Success notifications Error notifications Field-level validation Modal behavior

Example:

**DEV**: Email field displays *Please enter a valid email address.*

**PRODUCTION**: Email field displays *Invalid email.*

The system should report:

Mismatch Type: Validation Message

**DEV** Expected: Please enter a valid email address.

**PRODUCTION** Actual: Invalid email.

Status: **MISMATCH**

Capture the action that triggered the mismatch and the relevant screenshots.

Important: A matching UI does not automatically mean matching functionality. Validate observable behavior separately.

## Database and Data Comparison

Implement a separate data comparison module.

The objective is to verify whether the data displayed by **DEV** and **PRODUCTION** is consistent.

Examples:

Dashboard counts Total users Transaction amounts Order counts Account balances Table records Product quantities Report totals Dates Status values Pagination totals **API** response values

Example:

Field	**DEV**	**PRODUCTION**	Result
Total Users	1,**250**	1,**250**	**MATCH**
Total Orders	**500**	**498**	**MISMATCH**
Revenue	50,**000**	50,**000**	**MATCH**
Active Users	**450**	**460**	**MISMATCH**

Support configurable comparison rules:

Exact match Numeric comparison Decimal tolerance Date comparison Case-insensitive text comparison Null-value comparison Record count comparison Configurable ignored fields

Where authorized, support database comparison through read-only database connections or approved **API** endpoints.

Never assume that two environments should contain identical business data. Allow the QA engineer to configure expected equality, acceptable differences, test fixtures, and comparison rules.

Do not expose production credentials or sensitive database values in reports.

## Screenshot Comparison

For every interaction, capture:

**DEV** screenshot **PRODUCTION** screenshot Side-by-side comparison Difference-highlighted screenshot

Use Playwright screenshot capabilities and an image comparison library.

The visual comparison should identify:

Missing components Extra components Text differences Alignment differences Color differences Font differences Image differences Layout shifts

Provide an adjustable visual difference threshold.

Ignore or mask configurable dynamic areas such as:

Timestamps Random IDs Live counters Advertisements Dynamic charts User-specific content

Create highlighted difference regions so the QA engineer can immediately identify where the mismatch occurred.

## Real-Time Comparison Dashboard

Create a modern, professional QA dashboard.

The dashboard should contain:

Header Application name Project name **DEV** environment status **PRODUCTION** environment status Start comparison Pause comparison Stop comparison Export report ### Main Workspace

Display two synchronized browser views:

**LEFT**: **DEV**

**RIGHT**: **PRODUCTION**

Both browser windows should have:

Independent scrolling Synchronized navigation Visible loading indicators Session status Current page **URL** Interaction controls ### Difference Panel

Display detected differences in real time.

Example:

#	Page	Component	Difference	Severity

1	Login	Login Button	Color mismatch	Medium
2	Login	Email Field	Width mismatch	Low
3	Dashboard	Revenue	Value mismatch	High
4	Dashboard	Error Message	Text mismatch	Medium

Clicking a mismatch should:

Highlight the corresponding element in **DEV**. Highlight the corresponding element in **PRODUCTION**. Show the two screenshots. Show the exact difference. Show the **DOM** selector. Show relevant **CSS** values. Show the interaction that triggered the issue. ## Complete Execution Logging

Record every user interaction in an execution timeline.

Example:

Step	Action	**DEV** Result	**PRODUCTION** Result	Status
1	Open Login Page	Successful	Successful	**MATCH**
2	Enter Email	Successful	Successful	**MATCH**
3	Enter Password	Successful	Successful	**MATCH**
4	Click Login	Successful	Successful	**MATCH**
5	Open Dashboard	Successful	Successful	**MATCH**
6	Click Reports	Successful	Failed	**MISMATCH**
7	Open Page 2	Successful	Successful	**MATCH**

Every log should contain:

Timestamp Execution ID Page **URL** Action performed Element identifier **DEV** result **PRODUCTION** result Difference category Screenshot reference Severity Execution status ## AI-Powered Difference Analysis

Integrate an AI agent to analyze detected mismatches.

The AI should:

Explain the difference in simple language. Identify the likely root cause. Categorize the issue. Suggest possible **CSS** corrections. Identify missing elements. Explain validation differences. Detect potentially inconsistent application behavior. Suggest additional test scenarios.

Example:

Detected Issue: The **DEV** Login button is 120px wide, while the **PRODUCTION** Login button is 150px wide.

AI Analysis: The button dimensions are inconsistent between environments. The likely causes include different **CSS** width declarations, padding, or inherited styling.

Suggested Investigation: Compare computed width, padding, box-sizing, and relevant **CSS** selectors.

AI analysis must distinguish observed facts from hypotheses. It must not automatically modify or deploy application code.

## Final QA Report Generation

After the QA engineer completes the entire application flow, generate a comprehensive comparison report.

Report formats:

**HTML** **PDF** Excel **JSON**

The report should include:

### Executive Summary

Project name **DEV** **URL** **PRODUCTION** **URL** Execution date Total pages tested Total interactions Total successful comparisons Total mismatches Critical issues High-priority issues Medium-priority issues Low-priority issues ### Detailed Difference Report

For every mismatch include:

Issue ID Page name Page **URL** Component name Element selector Difference category **DEV** expected/observed value **PRODUCTION** observed value Difference description Severity Screenshot from **DEV** Screenshot from **PRODUCTION** Highlighted difference screenshot AI analysis Suggested investigation ### Visual Evidence

Include screenshots showing exactly where the difference was detected.

The report should be professional and suitable for sharing with developers, QA managers, and project stakeholders.

## Technology Stack

Use the following technologies unless a better architectural choice is justified:

Frontend:

React TypeScript Next.js Tailwind **CSS**

Backend:

Node.js TypeScript Express or Next.js **API** routes

Browser Automation:

Playwright Chromium

Visual Comparison:

Pixelmatch Sharp Screenshot comparison utilities

**DOM** Comparison:

Playwright **DOM** APIs Computed **CSS** extraction **DOM** structure comparison

Database:

PostgreSQL

Real-Time Communication:

WebSockets or Socket.IO

AI Integration:

Pluggable **LLM** provider AI-powered root-cause analysis

Reporting:

**PDF** generation Excel export **HTML** reports

Architecture:

Modular Scalable Maintainable Configurable Extensible ## Security Requirements

This tool will compare development and production environments.

Implement:

Authorized **URL** configuration. Secure credential management. Encrypted stored secrets. Read-only production database access. Masking of passwords and sensitive information. Protection against accidental production data modification. Explicit confirmation before sensitive actions. Configurable test-account usage. Audit logs. Session cleanup. Network access restrictions to approved environments.

The application must never perform destructive production actions by default.

## Important Technical Requirements

Do not build this as a simple screenshot comparison tool.

I need a complete synchronized browser automation and comparison platform.

The application must support:

Two independent browser contexts. Live interaction synchronization. **DOM**-based element identification. Automatic navigation synchronization. Screenshot comparison. **CSS** property comparison. Text and content comparison. Functional behavior comparison. Validation comparison. Configurable database and **API** data comparison. Real-time mismatch logging. AI-powered analysis. Complete end-to-end reporting.

If an action cannot be replicated, report it instead of silently skipping it.

Handle different loading times, asynchronous requests, dynamic content, and different application response times.

Provide a clear indication when an environment becomes unsynchronized.

Support manual resynchronization.

## Development Instructions

Start by designing the complete architecture.

Then implement the application in phases:

Phase 1: Project setup and dashboard UI.

Phase 2: **DEV** and **PRODUCTION** **URL** configuration.

Phase 3: Playwright browser session management.

Phase 4: Two-way-safe session synchronization with **DEV** as the default action source.

Phase 5: **DOM** and **CSS** comparison engine.

Phase 6: Screenshot comparison and visual highlighting.

Phase 7: Functional and validation comparison.

Phase 8: Database/**API** data comparison.

Phase 9: AI analysis and recommendations.

Phase 10: Execution logging and report generation.

Phase 11: Security, testing, and production readiness.

Do not stop after generating the UI.

Build actual working functionality with proper backend integration.

Provide:

Complete source code. Folder structure. Installation instructions. Environment configuration. Database schema. **API** documentation. Playwright implementation. Sample **DEV** and **PRODUCTION** applications for testing. Unit tests. Integration tests. End-to-end tests. Execution instructions. ## Acceptance Criteria

The project will be considered successful when:

I can enter two different application URLs. I can open both applications side by side. I can perform an action in **DEV**. The same corresponding action is performed in **PRODUCTION**. Both applications remain synchronized where possible. Every page and interaction can be compared. UI mismatches are detected. **CSS** mismatches are detected. Text and content mismatches are detected. Functional and validation differences are detected. Configured data comparisons work correctly. Every mismatch is recorded with supporting evidence. I can inspect each mismatch individually. I can generate a complete final QA report.

Final instruction:

Think and implement this as an enterprise-grade QA automation product that a QA engineer with 20 years of experience can use for real **DEV**-versus-**PRODUCTION** testing.

Prioritize accuracy, traceability, reliable synchronization, meaningful difference detection, and professional reporting.

Do not provide only a development plan. Implement the actual working application, test it, and explain how to run it. **BUILD** **THE** **COMPLETE** AI-**POWERED** **DEV** VS **PRODUCTION** QA **COMPARISON** **APPLICATION**

You are an expert Software Architect, Senior Full-Stack Developer, Playwright Automation Engineer, AI Agent Developer, and QA Automation Architect.

I want you to **BUILD** an actual, fully functional, enterprise-grade web application called:

QA **VISION** AI – **DEV** vs **PRODUCTION** **COMPARISON** **PLATFORM**

Do not just create a UI design, prototype, or project documentation. Build the complete working application.

## Core Requirement

The application must allow me to enter two URLs:

**DEV** Application **URL** **PRODUCTION** Application **URL**

After entering these URLs, open both applications side by side in the dashboard.

**DEV** must be the primary/reference environment.

Whenever I perform an action in **DEV**, the same corresponding action must automatically execute in **PRODUCTION**.

Examples:

Mouse clicks Double clicks Mouse hover Text entry Dropdown selections Checkbox selections Radio buttons Scrolling Tab navigation Pagination Form submissions Link navigation Modal interactions Keyboard interactions

Use Playwright to control both browser sessions.

Use **DOM**-based element identification instead of relying only on mouse coordinates.

If the corresponding element does not exist in **PRODUCTION**, immediately record a mismatch.

## Application Dashboard

Create a modern, professional enterprise dashboard.

Include:

Project configuration **DEV** **URL** **PRODUCTION** **URL** Browser session management Start comparison button Pause button Stop button Resynchronize button Live execution status Total actions performed Total pages visited Total mismatches Comparison history Export report

Display two browser views:

**LEFT**: **DEV** **APPLICATION**

**RIGHT**: **PRODUCTION** **APPLICATION**

Both must remain synchronized during the testing session.

## Automated Comparison Engine

Develop separate comparison modules.

UI comparison Layout Alignment Height and width Padding and margins Spacing Positioning Missing components Extra components **CSS** comparison Font family Font size Font weight Text color Background color Border Border radius Box shadow Display Visibility Opacity Flexbox Grid properties Text comparison Labels Headings Button text Placeholder text Table content Notifications Error messages Success messages Functional comparison Login Logout Navigation Buttons Forms Dropdowns Validations Pagination Modals **API** error handling Database and data comparison Dashboard values Counts Transaction amounts Table records Total records Financial values Dates Status fields **API** response values

Allow configurable rules for expected differences, dynamic values, test accounts, and acceptable tolerances.

Do not assume that production and development databases always contain identical business data.

## Screenshot Comparison

After every interaction:

Capture the **DEV** screenshot. Capture the **PRODUCTION** screenshot. Compare both images. Highlight visual differences. Identify the affected page and element. Save the evidence. Add the mismatch to the execution log.

Use Playwright, Pixelmatch, and Sharp.

Include:

Side-by-side screenshots. Overlay comparison. Highlighted difference screenshots. Adjustable difference threshold. Dynamic element masking. ## Real-Time Difference Log

Create a live issue panel.

Each mismatch should contain:

Unique issue ID Page name **URL** Element name **DOM** selector Difference category **DEV** value **PRODUCTION** value Severity Screenshot Timestamp Triggering action

Example:

Component	**DEV**	**PRODUCTION**	Status
Login Button	Blue	Green	Mismatch
Email Field	300px	300px	Match
Heading	Welcome	Welcome Back	Mismatch
Total Users	1,**250**	1,**250**	Match

Clicking an issue should show the exact screenshots and difference details.

## AI Analysis

Integrate an AI-powered analysis engine.

The AI should:

Explain mismatches. Identify likely root causes. Suggest possible fixes. Identify **CSS** inconsistencies. Explain validation differences. Categorize defects. Recommend additional test scenarios.

AI must clearly distinguish confirmed differences from suspected root causes.

Do not automatically change production code.

## Reporting Module

Generate a complete final QA report after execution.

Support:

**PDF** Excel **HTML** **JSON**

Include:

Project details **DEV** **URL** **PRODUCTION** **URL** Execution summary Pages tested Actions performed Total matches Total mismatches Severity breakdown UI differences **CSS** differences Functional differences Validation differences Data differences Screenshots AI analysis Detailed execution logs ## Recommended Technology Stack

Frontend:

Next.js React TypeScript Tailwind **CSS**

Backend:

Node.js TypeScript

Automation:

Playwright Chromium

Comparison:

Pixelmatch Sharp **DOM** comparison Computed **CSS** comparison

Database:

PostgreSQL

Communication:

Socket.IO

Reporting:

**PDF** generation ExcelJS **HTML** reports

AI:

Pluggable **LLM** integration ## Important Synchronization Requirements

The synchronization engine must be reliable.

Use:

**DOM** selectors Accessible roles Labels Text locators Stable attributes Element fingerprints

Handle:

Different loading times Dynamic content **AJAX** requests Navigation delays Missing elements Different page structures Different browser response times

If an action cannot be replicated, log it.

Provide a manual recovery and resynchronization option.

Do not silently skip failed actions.

## Security

Because this application interacts with production systems:

Require authorized application URLs. Use secure credential storage. Mask passwords and sensitive fields. Prefer approved test accounts. Use read-only database access. Require explicit approval for sensitive operations. Avoid destructive production operations. Maintain audit logs. Restrict browser access to approved environments. ## Development Execution Plan

Build in the following order:

Phase 1: Complete dashboard and frontend.

Phase 2: **DEV** and **PRODUCTION** configuration.

Phase 3: Playwright browser management.

Phase 4: Action recording and replication.

Phase 5: Navigation and interaction synchronization.

Phase 6: **DOM** comparison.

Phase 7: **CSS** comparison.

Phase 8: Screenshot comparison.

Phase 9: Functional and validation comparison.

Phase 10: Database/**API** data comparison.

Phase 11: AI mismatch analysis.

Phase 12: Execution history and report generation.

Phase 13: Security and automated testing.

## Mandatory Acceptance Tests

The finished application must demonstrate the following:

Enter **DEV** and **PRODUCTION** URLs. Open both applications. Log in using approved test accounts. Perform actions in **DEV**. Replicate actions in **PRODUCTION**. Navigate multiple pages. Compare every resulting screen. Detect missing elements. Detect font and **CSS** differences. Detect text and validation differences. Compare configured numeric values. Capture screenshots. Record every mismatch. Generate a complete **PDF** report. ## Final Instructions to the Coding Agent

Start implementing immediately.

First, inspect the existing development environment and available tools.

Then create the project structure and implement the complete application.

Do not stop after the first phase.

Do not return only sample code or pseudocode.

Create actual working files, connect frontend and backend, implement Playwright automation, connect the database, and test the application.

If external **API** keys are required, create a clear environment configuration and document them.

If a feature cannot be completed, explicitly identify it rather than presenting a mock implementation as a working feature.

Provide:

Complete source code. Working application. Database migrations. Installation instructions. Environment variables example. Sample test applications. Automated test cases. Final execution instructions.

The ultimate goal: I should be able to enter two URLs, open **DEV** and **PRODUCTION** side by side, perform my complete QA testing in **DEV**, automatically replicate those actions in **PRODUCTION**, identify every relevant difference, and download a professional end-to-end comparison report with screenshots and detailed evidence.

Build this as a real enterprise-grade software product, not a demo.
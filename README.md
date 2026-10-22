# E-Telly (Web)

E-Telly is a disaster-resilient, community-based early warning and response system developed for Antipolo City. The web application serves as the administrative and monitoring platform used by CDRRMO and barangay officials to manage AI-driven hazard predictions, resident reports, alerts, and evacuation information, complementing the E-Telly mobile application used by residents.

## Tech Stack

| Category | Technology/Tool | Purpose in the Project |
|---|---|---|
| Deployment | Heroku | Heroku is a cloud-based platform as a service that enables developers to host their application. This is used for the hosting of the web application and the backend. |
| Development Tools | Visual Studio Code | VS Code is used as the primary integrated development environment for the proponents to write and organize the source code of both web and mobile applications. The IDE provides extensions for JavaScript, and Dart, allowing developers to efficiently write, test, and maintain application code. |
| Security Tools | JSON Web Tokens (JWT) | JWT was implemented to manage logins. JWT enables safer user logins and store user roles. |
| Predictive Model | Logistic Regression | Used as the predictive model for AI-driven hazard prediction. |
| Offline Peer-To-Peer (Mesh) | Nearby Connections (Bluetooth) | Nearby Connections is a peer-to-peer API that allows discovering and connecting of nearby devices. This enabled the full offline functionality of the Chat and Report module of the mobile application. |
| Automation | Node-Cron | Node-Cron enables running code automatically at specified scheduled times. This is utilized to get information and create alerts at intervals. |
| Service | Firebase Cloud Messaging | Firebase Cloud Messaging is a Backend-as-a-Service that allows developers to send push notifications. It is specifically used in the reports and alerts on the web, and alerts on mobile. |
| Testing Tools | OWASP Zap, Apptim, Lighthouse, Security Browserling, Google Accessibility Scanner, Android Studio | Several testing tools were employed for the assessment of the system. OWASP Zap and Security Headers were used to test the web application's security, while Apptim, Lighthouse, Google Accessibility Scanner, Android Studio, and Browserling was utilized to measure the non-functionality aspect of the system. |
| Version Control | Git/GitHub | GitHub is a cloud platform that allows developers to store software code online. Updates and fixes are immediately applied through collaboration. |
| Documentation Tools | MS Word, Draw.io | Word is the primary documentation tool used to record the manuscript. Draw.io was used to create the figures needed for visualization of specific functions and structure of the system. |

> The table above reflects the tools cited in the manuscript. The full list of frameworks and libraries actually used in the codebase is below.

## Full Stack (from codebase)

### Web — Frontend (`client/`)
- React 19 + Vite
- Tailwind CSS
- React Router
- Leaflet / React-Leaflet (maps)
- Recharts (charts/analytics)
- Axios (HTTP client)
- Socket.io-client (realtime)
- vite-plugin-pwa (installable/offline web app)
- ESLint, PostCSS, Autoprefixer (dev/build tooling)

### Web — Backend (`server/`)
- Express 5 + Node.js
- MongoDB + Mongoose
- TensorFlow.js (AI hazard prediction model)
- Socket.io (realtime)
- JSON Web Tokens + bcryptjs (auth)
- Firebase Admin (push notifications)
- Cloudinary (media storage)
- Multer (file uploads)
- Node-cron (scheduled jobs)
- Nodemailer, web-push, ExcelJS, Cheerio
- Jest + Supertest + mongodb-memory-server (testing)

## Development

This project is built with React + Vite.

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

### React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

### Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

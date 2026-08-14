/**
 * Onboarding fixtures (P7.1.4, EC-P7-03).
 *
 * Static data. Nothing here touches a job board, an LLM, or the network — that
 * is the entire point: onboarding must not multiply scraping load by the signup
 * rate, and a new account should cost nothing to create.
 *
 * The persona matches `lib/sample-content.ts` (Jordan Lee, backend engineer) so
 * the sample resume and the sample jobs actually score against each other and
 * the demonstration shows a real spread rather than three identical numbers.
 * The links point at example.com, deliberately — a sample row that deep-links
 * to a real posting would send onboarding traffic to a live site, which is the
 * same failure by a quieter route.
 */

export const SAMPLE_RESUME_TEXT = `Jordan Lee
Austin, TX · jordan.lee@example.com · github.com/jordanlee

Summary
Backend engineer with 6 years building and operating high-traffic web services,
focused on reliable APIs, data pipelines, and developer tooling.

Skills
Python, Node.js, TypeScript, PostgreSQL, Redis, Docker, AWS, REST APIs, CI/CD

Experience
Senior Software Engineer — Brightwave Systems (2021–Present)
- Built and maintained REST APIs in Python and Node.js serving 3M daily requests.
- Reduced p95 latency on the checkout service by 40% by adding Redis caching.
- Led migration of the monolith's billing module into a standalone service.
- Mentored three junior engineers and ran weekly code review sessions.

Software Engineer — Datapeak Analytics (2018–2021)
- Developed ETL pipelines in Python processing 500GB of event data per day.
- Automated deployments with GitHub Actions, cutting release time from hours to minutes.
- Built an internal dashboard in React used by the analytics team daily.

Education
B.S. Computer Science, University of Texas at Austin (2014–2018)`;

/** Pre-parsed, so seeding costs no LLM call (EC-P7-03's cost argument again). */
export const SAMPLE_RESUME_PROFILE = {
  name: "Jordan Lee (sample)",
  email: "jordan.lee@example.com",
  summary:
    "Backend engineer with 6 years building and operating high-traffic web services.",
  skills: [
    "Python", "Node.js", "TypeScript", "PostgreSQL", "Redis",
    "Docker", "AWS", "REST APIs", "CI/CD",
  ],
  experience: [
    {
      company: "Brightwave Systems",
      title: "Senior Software Engineer",
      startDate: "2021",
      endDate: "Present",
      bullets: [
        "Built and maintained REST APIs in Python and Node.js serving 3M daily requests.",
        "Reduced p95 latency on the checkout service by 40% by adding Redis caching.",
        "Led migration of the monolith's billing module into a standalone service.",
        "Mentored three junior engineers and ran weekly code review sessions.",
      ],
    },
    {
      company: "Datapeak Analytics",
      title: "Software Engineer",
      startDate: "2018",
      endDate: "2021",
      bullets: [
        "Developed ETL pipelines in Python processing 500GB of event data per day.",
        "Automated deployments with GitHub Actions, cutting release time from hours to minutes.",
        "Built an internal dashboard in React used by the analytics team daily.",
      ],
    },
  ],
  education: [
    {
      school: "University of Texas at Austin",
      degree: "B.S. Computer Science",
      year: "2018",
    },
  ],
} as const;

interface SampleJob {
  title: string;
  company: string;
  location: string;
  link: string;
  description: string;
  /** Shaped like an extracted JD profile; typed as JSON for the Prisma write. */
  profile: {
    requiredSkills: string[];
    preferredSkills: string[];
    responsibilities: string[];
    qualifications: string[];
  };
}

/**
 * Three jobs, chosen to produce a VISIBLE score spread against the resume
 * above: a strong match, a partial one, and a poor one.
 *
 * A sample where everything scores 85 demonstrates nothing — the product's
 * claim is that it ranks and explains, and a flat set of scores shows neither.
 * The weak match is the important one, because it is what makes the
 * explanation column mean something.
 */
export const SAMPLE_JOBS: SampleJob[] = [
  {
    title: "Senior Backend Engineer, Platform",
    company: "Northstar Cloud",
    location: "Remote",
    link: "https://example.com/sample/northstar-backend",
    description: `Design and operate multi-tenant backend services at scale. Own service
reliability including on-call, SLOs, and incident response. Build internal
platform tooling that improves developer velocity.

Requirements
- 5+ years of backend engineering experience
- Strong Python or Node.js
- PostgreSQL and Redis in production
- Docker, AWS, CI/CD pipelines`,
    profile: {
      requiredSkills: ["Python", "Node.js", "PostgreSQL", "Redis", "AWS", "Docker"],
      preferredSkills: ["Kubernetes", "Terraform"],
      responsibilities: [
        "Operate multi-tenant backend services",
        "Own SLOs and incident response",
        "Build platform tooling",
      ],
      qualifications: ["5+ years backend engineering"],
    },
  },
  {
    title: "Full-Stack Engineer",
    company: "Meridian Labs",
    location: "Austin, TX",
    link: "https://example.com/sample/meridian-fullstack",
    description: `Build customer-facing features end to end. React on the front, Node on the
back. You will own features from design through deployment.

Requirements
- 3+ years full-stack experience
- React and TypeScript
- Node.js and REST APIs
- Comfortable with design work`,
    profile: {
      requiredSkills: ["React", "TypeScript", "Node.js", "REST APIs"],
      preferredSkills: ["Figma", "GraphQL"],
      responsibilities: ["Own features end to end", "Front-end and back-end work"],
      qualifications: ["3+ years full-stack"],
    },
  },
  {
    title: "Machine Learning Engineer, Ranking",
    company: "Vela AI",
    location: "San Francisco, CA",
    link: "https://example.com/sample/vela-ml",
    description: `Train and deploy ranking models in production. Own the offline-to-online
evaluation loop.

Requirements
- 4+ years applied ML
- PyTorch or TensorFlow
- Large-scale training infrastructure
- Published work in ranking or recommendations a plus`,
    profile: {
      requiredSkills: ["PyTorch", "TensorFlow", "Machine Learning", "Ranking"],
      preferredSkills: ["Spark", "Kubeflow"],
      responsibilities: ["Train ranking models", "Own evaluation loop"],
      qualifications: ["4+ years applied ML"],
    },
  },
];

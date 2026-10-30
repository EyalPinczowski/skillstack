import type { LocalDate } from '../dates';
import type { Task } from '../schemas';

/** Does finishing this task earn a certificate (spec 3.6)? */
export function earnsCertificate(task: Task): boolean {
  return task.isCertificate || task.type === 'cert_exam';
}

export function cvTaskId(certificateTaskId: string): string {
  return `cv-${certificateTaskId}`;
}

/**
 * The automatic "Update CV and LinkedIn" task (15 minutes) created when a certificate is
 * completed. It may not start before the completion date and the engine schedules CV updates
 * first, so it lands on the same day whenever there is any room left.
 */
export function createCvUpdateTask(certificate: Task, completedOn: LocalDate): Task {
  return {
    id: cvTaskId(certificate.id),
    title: `Update CV and LinkedIn: ${certificate.certificateName ?? certificate.title}`,
    type: 'cv_update',
    estHours: 0.25,
    doneHours: 0,
    status: 'pending',
    order: certificate.order,
    dependsOn: [certificate.id],
    isAnchor: false,
    notBefore: completedOn,
    splittable: false,
    isCertificate: false,
    lessons: [],
    howToSteps: [
      'Add the certificate to the certifications section of your CV.',
      'Add it to LinkedIn under Licenses & certifications, with the credential link if there is one.',
    ],
    source: 'auto',
  };
}

/** Adds the CV-update tasks a plan will get once its certificates are done (for projections). */
export function withProjectedCvTasks(tasks: Task[]): Task[] {
  const existing = new Set(tasks.map((t) => t.id));
  const extra = tasks
    .filter(
      (t) =>
        earnsCertificate(t) &&
        (t.status === 'pending' || t.status === 'in_progress') &&
        !existing.has(cvTaskId(t.id)),
    )
    .map((t) => {
      const { notBefore: _unused, ...cv } = createCvUpdateTask(t, '2000-01-01');
      void _unused;
      return cv;
    });
  return [...tasks, ...extra];
}

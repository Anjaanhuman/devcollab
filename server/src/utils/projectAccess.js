export function isProjectMember(project, userId) {
  const id = String(userId);
  return String(project.owner) === id || project.members.some((member) => String(member.user?._id ?? member.user) === id);
}

export function projectRole(project, userId) {
  const id = String(userId);
  if (String(project.owner) === id) return 'Owner';
  return project.members.find((member) => String(member.user?._id ?? member.user) === id)?.role ?? null;
}

export function canManageProject(project, userId, userRole) {
  return userRole === 'admin' || ['Owner', 'Team Leader'].includes(projectRole(project, userId));
}

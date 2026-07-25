import { chooseCurrentUser } from "@/server/session-actions";
import { explicitDevFallbackUsername, getCurrentUser, getSelectableUsers } from "@/server/current-user";

export async function CurrentUserSelector({ redirectTo }: { redirectTo: string }) {
  let loaded:
    | [
        Awaited<ReturnType<typeof getCurrentUser>>,
        Awaited<ReturnType<typeof getSelectableUsers>>
      ]
    | null = null;
  let errorMessage = "Account selector unavailable.";

  try {
    loaded = await Promise.all([getCurrentUser(), getSelectableUsers()]);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : errorMessage;
  }

  if (loaded == null) {
    return (
      <div className="accountSelector accountSelectorNotice">
        <span>Current user fallback: {explicitDevFallbackUsername}</span>
        <small>{errorMessage}</small>
      </div>
    );
  }

  const [currentUser, users] = loaded;
  return (
    <form action={chooseCurrentUser} className="accountSelector">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <label>
        Current user
        <select name="username" defaultValue={currentUser.username}>
          {users.map((user) => (
            <option key={user.username} value={user.username}>
              {user.displayName} - {user.role.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Switch</button>
    </form>
  );
}

import { chooseCurrentUser } from "@/server/session-actions";
import { explicitDevFallbackUsername, getCurrentUser, getSelectableUsers } from "@/server/current-user";

export async function CurrentUserSelector({ redirectTo }: { redirectTo: string }) {
  try {
    const [currentUser, users] = await Promise.all([getCurrentUser(), getSelectableUsers()]);

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
  } catch (error) {
    return (
      <div className="accountSelector accountSelectorNotice">
        <span>Current user fallback: {explicitDevFallbackUsername}</span>
        <small>{error instanceof Error ? error.message : "Account selector unavailable."}</small>
      </div>
    );
  }
}

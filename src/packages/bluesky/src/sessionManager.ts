import { Agent, CredentialSession, AtpAgentLoginOpts } from '@atproto/api';
import { XRPCError } from '@atproto/xrpc';

/**
 * Manages Bluesky authentication session lifecycle.
 */
export class SessionManager {
    private readonly sessionManager: CredentialSession;
    private readonly agent: Agent;

    constructor(serviceUrl: URL) {
        this.sessionManager = new CredentialSession(serviceUrl);
        this.agent = new Agent(this.sessionManager);
    }

    /**
     * Get the underlying Agent instance for API calls
     */
    getAgent(): Agent {
        return this.agent;
    }

    /**
     * Get the user's DID if authenticated
     */
    getDid(): string | undefined {
        return this.sessionManager.session?.did || this.agent.did;
    }

    /**
     * Login with credentials
     * @throws Error on authentication failure
     */
    async login(opts: AtpAgentLoginOpts): Promise<void> {
        try {
            await this.sessionManager.login(opts);
        } catch (error) {
            if (error instanceof XRPCError && error.status === 401) {
                throw new Error('Authentication failed: invalid credentials');
            }
            throw error;
        }
    }
}

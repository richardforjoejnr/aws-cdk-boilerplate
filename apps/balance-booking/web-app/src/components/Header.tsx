import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBasket } from '../contexts/BasketContext';

export function Header() {
  const { user, signOut } = useAuth();
  const { items } = useBasket();
  const isAdmin = user?.groups.includes('admin') ?? false;

  return (
    <header className="border-b border-stone bg-white">
      <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
        <Link to="/" className="no-underline">
          <span className="font-display text-3xl tracking-widest text-charcoal">BALANCE</span>
          <span className="ml-3 text-text-muted text-sm">mind · body · strength</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <NavItem to="/">Schedule</NavItem>
          {user && <NavItem to="/my/bookings">My bookings</NavItem>}
          {isAdmin && <NavItem to="/admin">Admin</NavItem>}
          <Link to="/basket" className="no-underline relative">
            <span className="px-3 py-2 rounded-full bg-blush-deep text-white text-sm">
              Basket{items.length > 0 ? ` (${items.length})` : ''}
            </span>
          </Link>
          {user ? (
            <button
              type="button"
              onClick={() => void signOut()}
              className="text-text-muted hover:text-charcoal"
            >
              Sign out
            </button>
          ) : (
            <SignInLink />
          )}
        </nav>
      </div>
    </header>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `no-underline ${isActive ? 'text-charcoal font-medium' : 'text-text-muted hover:text-charcoal'}`
      }
    >
      {children}
    </NavLink>
  );
}

function SignInLink() {
  return (
    <Link to="/auth/callback" className="text-text-muted hover:text-charcoal no-underline">
      Sign in
    </Link>
  );
}

"""FastAPI dependencies: current user resolution and role guards."""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_token
from app.models import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_PREFIX}/auth/login")

CREDENTIALS_EXC = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_token(token)
    if not payload or "sub" not in payload:
        raise CREDENTIALS_EXC
    user = await db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise CREDENTIALS_EXC
    return user


def require_roles(*roles: UserRole):
    allowed = {r.value for r in roles}

    async def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return user

    return _checker


require_admin = require_roles(UserRole.administrator)
require_staff = require_roles(UserRole.administrator, UserRole.staff)

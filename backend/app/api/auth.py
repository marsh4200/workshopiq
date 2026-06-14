"""Authentication endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.security import (
    create_access_token,
    hash_password_async,
    verify_password_async,
)
from app.models import User
from app.schemas import ChangePasswordRequest, Token, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=Token)
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.username == form.username))
    user = result.scalar_one_or_none()
    password_ok = await verify_password_async(
        form.password, user.hashed_password if user else None
    )
    if not user or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    token = create_access_token(user.id, user.role)
    return Token(
        access_token=token,
        must_change_password=user.must_change_password,
        role=user.role,
        username=user.username,
    )


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password", response_model=UserOut)
async def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await verify_password_async(payload.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password) < 6:
        raise HTTPException(
            status_code=400, detail="New password must be at least 6 characters"
        )
    user.hashed_password = await hash_password_async(payload.new_password)
    user.must_change_password = False
    await db.commit()
    await db.refresh(user)
    return user

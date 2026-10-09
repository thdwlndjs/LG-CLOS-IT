from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, MetaData, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import DateTime


class Base(DeclarativeBase):
    metadata = MetaData(schema="wardrobe")


class Household(Base):
    __tablename__ = "household"
    __table_args__ = (CheckConstraint("length(btrim(name))>0"),)
    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True,
                                   server_default=text("gen_random_uuid()"))
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                              server_default=text("now()"))


class Member(Base):
    __tablename__ = "member"
    __table_args__ = (UniqueConstraint("id", "household_id"),
                     CheckConstraint("role IN ('OWNER','MEMBER','CHILD')"))
    id: Mapped[UUID] = mapped_column(PGUUID, primary_key=True,
                                   server_default=text("gen_random_uuid()"))
    household_id: Mapped[UUID] = mapped_column(ForeignKey("wardrobe.household.id"))
    display_name: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, server_default=text("'MEMBER'"))
    external_subject: Mapped[str | None] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                              server_default=text("now()"))


# Only platform models are mapped in Sprint 0. All 30 physical tables are created by
# the authoritative SQL baseline. Add domain mappings vertically in their Sprint;
# never call Base.metadata.create_all() or autogenerate from this partial metadata.


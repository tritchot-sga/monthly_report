from setuptools import setup, find_packages

with open("requirements.txt") as f:
	install_requires = f.read().strip().split("\n")

# get version from __version__ variable in monthly_report/__init__.py
from monthly_report import __version__ as version

setup(
	name="monthly_report",
	version=version,
	description="Generates monthly financial reports",
	author="Farabi Hussain",
	author_email="farabi.hussain@sgatechsolutions.com",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires
)

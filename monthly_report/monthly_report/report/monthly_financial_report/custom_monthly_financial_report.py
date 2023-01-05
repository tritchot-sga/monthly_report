# Copyright (c) 2022, Farabi Hussain

import frappe, calendar, copy, datetime, json

from frappe import _, qb, scrub, publish_progress
from frappe.query_builder import CustomFunction
from frappe.query_builder.functions import Max
from frappe.utils import date_diff, flt, getdate, cint, flt
from erpnext.controllers.queries import get_match_cond
from erpnext.accounts.report.financial_statements import *
from erpnext.accounts.report.balance_sheet.balance_sheet import (execute, check_opening_balance, get_provisional_profit_loss)
from erpnext.stock.utils import get_incoming_rate
from collections import OrderedDict

global_fiscal_year = 0
balance_sheet_start_date = ""
balance_sheet_end_date = ""
old_method = False


## ============================================================================================================================================
## FUNCTION CALLED FROM JAVASCRIPT
## ============================================================================================================================================
 
@frappe.whitelist()
def run_queries(filters, cost_center_name = ""):
    filters = frappe._dict(json.loads(filters) or {})

    if (cost_center_name == "Consolidated"):
        return run_consolidated_query(filters)
    elif (cost_center_name == "Balance Sheet"):
        return run_balance_sheet_query(filters)
    else:
        return run_cost_center_query(filters, cost_center_name)


## 
def run_balance_sheet_query(filters):
    global balance_sheet_start_date
    global balance_sheet_end_date
    
    balance_sheet_start_date = get_year_start_date(filters.to_fiscal_year, filters.period_end_month)
    balance_sheet_end_date = get_year_end_date(filters.to_fiscal_year, filters.period_end_month)
    dataset = []

    # generate the balance sheet
    print("Getting data for Balance Sheet")
    balance_sheet_dataset = (get_balance_sheet(filters))
    dataset.append(balance_sheet_dataset[0])
    dataset.append(balance_sheet_dataset[1])

    return dataset


## 
def run_cost_center_query(filters, cost_center_name):
    dataset = []

    period = get_income_statement_period(
        to_fiscal_year            = filters.to_fiscal_year,
        periodicity               = filters.periodicity,
        period_end_month          = filters.period_end_month,
        company                   = filters.company,
        accumulated_values        = False,  # default value
        reset_period_on_fy_change = True,   # default value
        ignore_fiscal_year        = False   # default value
    )

    print("Getting data for " + cost_center_name.split(" ")[0])
    cost_center_data = get_cost_center_data(filters, period, cost_center_name)
    dataset.append(cost_center_data[0])
    dataset.append(cost_center_data[1])

    return dataset


## calls the functions above and generated Income Statement data
def run_consolidated_query(filters):
    data = []
    dataset = []

    # first append the header for Consolidated
    dataset_header = [{"dataset_for": "Consolidated"}]
    dataset.append(dataset_header)

    print("Getting data for Consolidated")

    period = get_income_statement_period(
        to_fiscal_year            = filters.to_fiscal_year,
        periodicity               = filters.periodicity,
        period_end_month          = filters.period_end_month,
        company                   = filters.company,
        accumulated_values        = False,  # default value
        reset_period_on_fy_change = True,   # default value
        ignore_fiscal_year        = False   # default value
    )

    income = get_income_statement_data(
        period_end_month                 = filters.period_end_month,
        period_end_year                  = filters.to_fiscal_year,
        company                          = filters.company,
        root_type                        = "Income",
        balance_must_be                  = "Credit",
        period_list                      = period,
        filters                          = filters,
        accumulated_values               = filters.accumulated_values,
        only_current_fiscal_year         = True,  # default value
        ignore_closing_entries           = True,
        ignore_accumulated_values_for_fy = True,
        total                            = True   # default value
    )

    expense = get_income_statement_data(
        period_end_month                 = filters.period_end_month,
        period_end_year                  = filters.to_fiscal_year,
        company                          = filters.company,
        root_type                        = "Expense",
        balance_must_be                  = "Debit",
        period_list                      = period,
        filters                          = filters,
        accumulated_values               = filters.accumulated_values,
        only_current_fiscal_year         = True,  # default value
        ignore_closing_entries           = True,
        ignore_accumulated_values_for_fy = True,
        total                            = True   # default value
    )

    # append the dataset for Consolidated
    data.extend(income)
    data.extend(expense)
    dataset.append(data)

    return dataset


## not used as filters have defaults
def validate_filters(filters):
    # validate the selected filters
    if not filters:
        return [], [], None, []
    if not filters.period_end_month:
        frappe.throw(_("Please select a month."))
    if not filters.to_fiscal_year:
        frappe.throw(_("Please select a year."))
    if not filters.cost_center:
        frappe.throw(_("Please select at least one cost center."))


## 
def get_year_end_date(to_fiscal_year, period_end_month):
    from_fiscal_year = str(int(to_fiscal_year) - 1)# we want to run this on the same fiscal year, so from_fiscal_year = to_fiscal_year
    fiscal_year = get_fiscal_year_data(from_fiscal_year, to_fiscal_year)

    year_end_date = str(fiscal_year.year_end_date)[0:4]   # yyyy
    selected_month_in_int = list(calendar.month_abbr).index(period_end_month[0:3]) # convert the selected month into int

    # prefix month number with 0 when needed
    if (len(str(selected_month_in_int)) == 1):
        year_end_date += "-0" + str(selected_month_in_int) + "-" # -0m-
    else:
        year_end_date += "-" + str(selected_month_in_int) + "-" # -mm-
    

    if (selected_month_in_int == 1
        or selected_month_in_int == 3
        or selected_month_in_int == 5
        or selected_month_in_int == 7
        or selected_month_in_int == 8
        or selected_month_in_int == 10
        or selected_month_in_int == 12
    ):
        year_end_date += "31"

    elif (selected_month_in_int == 2):
        if (int(str(fiscal_year.year_end_date)[0:4]) % 4 == 0):
            year_end_date += "29"
        else:
            year_end_date += "28"

    else:
        year_end_date += "30"

    # global balance_sheet_end_date
    # balance_sheet_end_date = year_end_date 

    return getdate(year_end_date)


## 
def get_year_start_date(to_fiscal_year, period_end_month):
    from_fiscal_year = str(int(to_fiscal_year))# we want to run this on the same fiscal year, so from_fiscal_year = to_fiscal_year
    fiscal_year = get_fiscal_year_data(from_fiscal_year, to_fiscal_year)

    fiscal_starting_month_in_int = int(fiscal_year.year_start_date.strftime("%m")) # convert the fiscal year's starting month into int
    selected_month_in_int = list(calendar.month_abbr).index(period_end_month[0:3]) # convert the selected month into int

    if (selected_month_in_int < fiscal_starting_month_in_int):
        build_start_year_and_date = (str(int(from_fiscal_year)-1) + '-' + str(selected_month_in_int) + '-01')
        year_start_date = getdate(build_start_year_and_date)
    else:
        year_start_date = getdate(fiscal_year.year_start_date)

    # balance_sheet_year  = str(int(fiscal_year.year_start_date.strftime("%Y"))+1)
    # balance_sheet_month = str(fiscal_year.year_start_date.strftime("%m"))
    # balance_sheet_date  = str(fiscal_year.year_start_date.strftime("%d"))

    # global balance_sheet_start_date
    # balance_sheet_start_date = balance_sheet_year + "-" + balance_sheet_month + "-" + balance_sheet_date

    return year_start_date


## ============================================================================================================================================
## INCOME STATEMENT FUNCTIONS
## ============================================================================================================================================


## 
def get_cost_center_data(filters, period, center_name):
    filters.cost_center = [center_name]

    income = get_income_statement_data(
        period_end_month                 = filters.period_end_month,
        period_end_year                  = filters.to_fiscal_year,
        company                          = filters.company,
        root_type                        = "Income",
        balance_must_be                  = "Credit",
        period_list                      = period,
        filters                          = filters,
        accumulated_values               = filters.accumulated_values,
        only_current_fiscal_year         = True,  # default value
        ignore_closing_entries           = True,
        ignore_accumulated_values_for_fy = True,
        total                            = True   # default value
    )

    expense = get_income_statement_data(
        period_end_month                 = filters.period_end_month,
        period_end_year                  = filters.to_fiscal_year,
        company                          = filters.company,
        root_type                        = "Expense",
        balance_must_be                  = "Debit",
        period_list                      = period,
        filters                          = filters,
        accumulated_values               = filters.accumulated_values,
        only_current_fiscal_year         = True,  # default value
        ignore_closing_entries           = True,
        ignore_accumulated_values_for_fy = True,
        total                            = True   # default value
    )
    
    dataset_header = [{"dataset_for": center_name}]
    data = []
    data.extend(income or [])
    data.extend(expense or [])

    return dataset_header, data


## overriden from financial_statements.py -- returns the timeframe for which this report is generated
def get_income_statement_period(to_fiscal_year, periodicity, period_end_month, company, accumulated_values=False, reset_period_on_fy_change=True, ignore_fiscal_year=False):
    # by default it gets the start month of the fiscal year, which can be different from January
    # but the first column should be the same column as the selected month, which may be from before the current fiscal year
    # to circumvent this, we pick months from the beginning of the calendar year if its before the fiscal year

    from_fiscal_year = str(int(to_fiscal_year) - 1)# we want to run this on the same fiscal year, so from_fiscal_year = to_fiscal_year
    fiscal_year = get_fiscal_year_data(from_fiscal_year, to_fiscal_year)
    year_start_date = get_year_start_date(to_fiscal_year, period_end_month)
    year_end_date = get_year_end_date(to_fiscal_year, period_end_month)

    global global_fiscal_year
    global balance_sheet_end_date
    global balance_sheet_start_date
    global_fiscal_year = fiscal_year
    balance_sheet_start_date = year_start_date 
    balance_sheet_end_date = year_end_date

    period_list = []
    start_date = year_start_date

    # add get the number of months between year_start_date & year_end_date
    # append that many months to the period_list array
    for i in range(get_months(year_start_date, year_end_date)):
        period = frappe._dict({"from_date": start_date})
        to_date = add_months(start_date, 1)
        start_date = to_date
        to_date = add_days(to_date, -1) # subtract one day from to_date, as it may be first day in next fiscal year or month

        if (to_date <= year_end_date): 
            period.to_date = to_date # the normal case
        else:
            period.to_date = year_end_date # if a fiscal year ends before a 12 month period

        period.to_date_fiscal_year = get_fiscal_year(period.to_date, company=company)[0]
        period.from_date_fiscal_year_start_date = get_fiscal_year(period.from_date, company=company)[1]

        period_list.append(period)

        if period.to_date == year_end_date:
            break

    # add key, label, year_start_date and year_end_date fields to each period in the list
    for period in period_list:
        key = period["to_date"].strftime("%b_%Y").lower()
        label = formatdate(period["to_date"], "MMM YYYY")

        period.update({
            "key": key.replace(" ", "_").replace("-", "_"),
            "label": label,
            "year_start_date": year_start_date,
            "year_end_date": year_end_date,
        })

    return period_list


## overriden from financial_statements.py
def get_income_statement_data(period_end_month, period_end_year, company, root_type, balance_must_be, period_list, filters, accumulated_values=1, only_current_fiscal_year=True, ignore_closing_entries=False, ignore_accumulated_values_for_fy=False, total=True):
    end_month_and_year = (period_end_month[0:3] + " " + period_end_year)
    accounts = get_accounts(company, root_type)
    
    if not accounts:
        return None

    accounts, accounts_by_name, parent_children_map = filter_accounts(accounts)
    company_currency = get_appropriate_currency(company, filters)
    gl_entries_by_account = {}

    # extracts the root of the trees "Income" and "Expenses"
    # only two elements in this dict
    # print("\tgetting list of accounts -- income statement [" + root_type + "]")
    accounts_list = frappe.db.sql(
        """
        SELECT  lft, rgt 
        FROM    tabAccount
        WHERE   root_type=%s AND IFNULL(parent_account, '') = ''
        """,
        root_type,
        as_dict = True
    )

    # for both of the trees, extract the leaves and populate gl_entries_by_account
    for root in accounts_list:
        set_income_statement_entries(company, period_list[0]["year_start_date"] if only_current_fiscal_year else None, period_list[-1]["to_date"], root.lft, root.rgt, filters, gl_entries_by_account, ignore_closing_entries=ignore_closing_entries)

    calculate_values(accounts_by_name, gl_entries_by_account, period_list, accumulated_values, ignore_accumulated_values_for_fy) ## function imported from financial_statements.py
    accumulate_values_into_parents(accounts, accounts_by_name, period_list)                                                      ## function imported from financial_statements.py
    out = prepare_income_statement_data(end_month_and_year, accounts, balance_must_be, period_list, company_currency)
    out = filter_out_zero_value_rows(out, parent_children_map)

    for data in out:
        if data:
            if data.account: 
                if data.account[-5:] == " - WW":
                    data.account = (data.account)[:-5]
            if data.parent_account:
                if data.parent_account[-5:] == " - WW":
                    data.parent_account = (data.parent_account)[:-5]

    return out


## overriden from financial_statements.py -- calculates the dollar values to be put in each cell, one row at a time; called from get_income_statement_data()
def prepare_income_statement_data(end_month_and_year, accounts, balance_must_be, period_list, company_currency):
    data = []
    year_start_date = period_list[0]["year_start_date"].strftime("%Y-%m-%d")
    year_end_date = period_list[-1]["year_end_date"].strftime("%Y-%m-%d")

    # variables for current fiscal year calculation
    global global_fiscal_year
    fiscal_year_start_month_in_int = int(global_fiscal_year.year_start_date.strftime("%m"))
    fiscal_year_in_int = int(global_fiscal_year.year_start_date.strftime("%Y"))
    fiscal_year_stamp = ((fiscal_year_in_int + 1) * 100) + fiscal_year_start_month_in_int

    # variables for previous fiscal year calculation
    prev_fiscal_year_end_month = list(calendar.month_abbr).index(end_month_and_year[0:3])
    prev_fiscal_year_start = ((fiscal_year_in_int) * 100) + fiscal_year_start_month_in_int
    prev_fiscal_year_end = ((fiscal_year_in_int + 1) * 100) + prev_fiscal_year_end_month

    counter = len(accounts)
    current = 0

    for account in accounts:
        has_value = False
        total = 0
        prev_year_total = 0
        print_group = frappe.db.sql(
            """
            SELECT  print_group 
            FROM    tabAccount 
            WHERE   name = %s
            """,
            account.name
        )

        row = frappe._dict(
            {
                "account": _(account.name),
                "parent_account": _(account.parent_account) if account.parent_account else "",
                "indent": flt(account.indent),
                "year_start_date": year_start_date,
                "year_end_date": year_end_date,
                "currency": company_currency,
                "include_in_gross": account.include_in_gross,
                "account_type": account.account_type,
                "is_group": account.is_group,
                "opening_balance": account.get("opening_balance", 0.0) * (1 if balance_must_be == "Debit" else -1),
                "account_name": (
                    "%s - %s" % (_(account.account_number), _(account.account_name))
                    if account.account_number
                    else _(account.account_name)
                ),
            }
        )

        for period in period_list:
            if account.get(period.key) and balance_must_be == "Credit":
                account[period.key] *= -1 # change sign based on Debit or Credit, since calculation is done using (debit - credit)

            row[period.key] = flt(account.get(period.key, 0.0), 3)

            # ignore zero values
            if abs(row[period.key]) >= 0.005:
                has_value = True

                current_month_in_int = list(calendar.month_abbr).index(period.label[0:3]) # convert month name to month number
                current_year_in_int = int(period.label[4:8])                              # period.label contains the date and time
                current_year_stamp = (current_year_in_int * 100) + current_month_in_int   # creates a timestamp in the format yyyymm for date comparison

                if (current_year_stamp >= fiscal_year_stamp):
                    total += flt(row[period.key])

                if (prev_fiscal_year_start <= current_year_stamp and current_year_stamp <= prev_fiscal_year_end):
                    prev_year_total += flt(row[period.key])
            
            if (period.label == end_month_and_year):
                break

        if (row["is_group"] == False): 
            row["account"] = print_group[0][0]

        if (row["account"] == ""):
            row["account"] = row["account_name"]

        row["has_value"] = has_value
        row["total"] = total
        row["print_group"] = print_group[0][0]
        row["prev_year_total"] = prev_year_total

        data.append(row)
        current += 1
        # if ((current/counter * 100) % 5 < 0.25): print("\tpreparing data " + str(int(current/counter * 100)) + "%")

    return data


## overriden from financial_statements.py; called from get_income_statement_data()
def set_income_statement_entries(company, from_date, to_date, root_lft, root_rgt, filters, gl_entries_by_account, ignore_closing_entries=False):
    # Returns a dict like { "account": [gl entries], ... }
    additional_conditions = get_additional_conditions(from_date, ignore_closing_entries, filters)

    accounts = frappe.db.sql_list(
        """
        SELECT
            name
        FROM 
            `tabAccount`
        WHERE 
            lft >= %s
            AND rgt <= %s
            AND company = %s
        """,
        (root_lft, root_rgt, company)
    )

    if accounts:
        additional_conditions += " AND account IN ({})".format(
            ", ".join(frappe.db.escape(account) for account in accounts)
        )

        gl_filters = {
            "company": company,
            "from_date": from_date,
            "to_date": to_date,
            "finance_book": cstr(filters.get("finance_book")),
        }

        if filters.get("include_default_book_entries"):
            gl_filters["company_fb"] = frappe.db.get_value("Company", company, "default_finance_book")

        for key, value in filters.items():
            if value:
                gl_filters.update({key: value})

        distributed_cost_center_query = ""

        if filters and filters.get("cost_center"):
            distributed_cost_center_query = (
                """
                UNION ALL
                SELECT 
                    posting_date,
                    account,
                    debit*(DCC_allocation.percentage_allocation/100) AS debit,
                    credit*(DCC_allocation.percentage_allocation/100) AS credit,
                    is_opening,
                    fiscal_year,
                    debit_in_account_currency*(DCC_allocation.percentage_allocation/100) AS debit_in_account_currency,
                    credit_in_account_currency*(DCC_allocation.percentage_allocation/100) AS credit_in_account_currency,
                    account_currency
                FROM 
                    `tabGL Entry`,
                    (
                        SELECT 
                            parent, 
                            sum(percentage_allocation) AS percentage_allocation
                        FROM 
                            `tabDistributed Cost Center`
                        WHERE 
                            cost_center IN %(cost_center)s
                            AND parent NOT IN %(cost_center)s
                        GROUP BY 
                            parent
                    ) AS DCC_allocation
                WHERE 
                    company=%(company)s
                    {additional_conditions}
                    AND posting_date <= %(to_date)s
                    AND is_cancelled = 0
                    AND cost_center = DCC_allocation.parent
                """.format(
                    additional_conditions = additional_conditions.replace("AND cost_center IN %(cost_center)s ", "")
                )
            )

        gl_entries = frappe.db.sql(
            """
            SELECT 
                posting_date,
                account,
                debit,
                credit,
                is_opening,
                fiscal_year,
                debit_in_account_currency,
                credit_in_account_currency,
                account_currency 
            FROM 
                `tabGL Entry`
            WHERE 
                company=%(company)s
                {additional_conditions}
                AND posting_date <= %(to_date)s
                AND is_cancelled = 0
                {distributed_cost_center_query}
            """.format(
                additional_conditions=additional_conditions,
                distributed_cost_center_query=distributed_cost_center_query,
            ),
            gl_filters,
            as_dict = True,
        )

        if filters and filters.get("presentation_currency"):
            convert_to_presentation_currency(gl_entries, get_currency(filters), filters.get("company"))

        for entry in gl_entries:
            gl_entries_by_account.setdefault(entry.account, []).append(entry)


## ============================================================================================================================================
## BALANCE SHEET FUNCTIONS
## ============================================================================================================================================


#
def get_balance_sheet(filters):
    columns = [{"dataset_for": "Balance Sheet"}]
    data = []
    cost_centers_string = (str(filters.cost_center)).replace("\'", "\"")

    new_filters_string = (
        '{"company": "White-Wood Distributors Ltd", ' + 
        '"filter_based_on": "Date Range", ' + 
        '"period_start_date": "' + str(balance_sheet_start_date) + '", ' + 
        '"period_end_date": "' + str(balance_sheet_end_date) + '", ' + 
        '"from_fiscal_year": "2023", ' + 
        '"to_fiscal_year": "2023", ' + 
        '"periodicity": "Monthly", ' + 
        '"cost_center": ' + cost_centers_string + ', ' + 
        '"accumulated_values": 1, ' + 
        '"include_default_book_entries": 1}'
    )

    new_filters = frappe._dict(json.loads(new_filters_string) or {})

    if old_method:
        period_list = get_period_list(new_filters.from_fiscal_year, new_filters.to_fiscal_year, balance_sheet_start_date, balance_sheet_end_date, new_filters.filter_based_on, new_filters.periodicity, company = new_filters.company)
        asset       = get_balance_sheet_data(new_filters.company, "Asset",     "Debit",  period_list, filters = new_filters, accumulated_values = new_filters.accumulated_values, only_current_fiscal_year = False)
        liability   = get_balance_sheet_data(new_filters.company, "Liability", "Credit", period_list, filters = new_filters, accumulated_values = new_filters.accumulated_values, only_current_fiscal_year = False)
        equity      = get_balance_sheet_data(new_filters.company, "Equity",    "Credit", period_list, filters = new_filters, accumulated_values = new_filters.accumulated_values, only_current_fiscal_year = False)

        provisional_profit_loss, total_credit = get_provisional_profit_loss(asset, liability, equity, period_list, new_filters.company)
        opening_balance = check_opening_balance(asset, liability, equity)

        data.extend(asset or [])
        data.extend(liability or [])
        data.extend(equity or [])

        if opening_balance and round(opening_balance[1], 2) != 0:
            unclosed = {
                "account_name": "'" + _("Unclosed Fiscal Years Profit / Loss (Credit)") + "'",
                "account": "'" + _("Unclosed Fiscal Years Profit / Loss (Credit)") + "'",
                "warn_if_negative": True,
            }
            for period in period_list:
                unclosed[period.key] = opening_balance
                if provisional_profit_loss:
                    provisional_profit_loss[period.key] = provisional_profit_loss[period.key] - opening_balance[1]

            unclosed["total"] = opening_balance
            data.append(unclosed)

        if provisional_profit_loss:
            data.append(provisional_profit_loss)

        if total_credit:
            data.append(total_credit)
    else:
        data = execute(new_filters)[1]

        lmao = 0
        for row in data:
            if (not row):
                lmao += 1 
            else:
                # if ("Total Asset (Debit)"                not in row["account_name"] and
                #     "Total Liability (Credit)"           not in row["account_name"] and
                #     "Provisional Profit / Loss (Credit)" not in row["account_name"] and
                #     "Total (Credit)"                     not in row["account_name"] and 
                #     "Total Equity (Credit)"              not in row["account_name"]
                # ):

                if ("account_name" in row and "parent_account" in row):
                    print_group = frappe.db.sql("""SELECT print_group FROM tabAccount WHERE name = %s""", row["account"])

                    if print_group:
                        row["print_group"] = print_group[0][0]

                    if (row["account"]):
                        if (row["account"][-5:] == " - WW"):
                            row["account"] = (row["account"])[:-5]

                    if (row["parent_account"][-5:] == " - WW"):
                        row["parent_account"] = (row["parent_account"])[:-5]

                    if (row["is_group"] == False): 
                        row["account"] = print_group[0][0]

                    if (row["account"] and row["account"] == ""):
                        row["account"] = row["account_name"]
                        
                    if (row["indent"] == 3):
                        row["indent"] = 2

                    if (row["parent_account"] == "Accounts Receivable" or row["parent_account"] == "Bank" or row["parent_account"] == "Inventory" or row["parent_account"] == "Other Current Assets"): 
                        row["parent_account"] = "Current Assets"

                    if (row["account"]):
                        row["account"].replace("'", "")


    return columns, data


## overriden from financial_statements.py
def get_balance_sheet_data(company, root_type, balance_must_be, period_list, filters, accumulated_values=1, only_current_fiscal_year=True, ignore_closing_entries=False, ignore_accumulated_values_for_fy=False, total=True):

    accounts = get_accounts(company, root_type)

    if not accounts:
        return None

    accounts, accounts_by_name, parent_children_map = filter_accounts(accounts)
    company_currency = get_appropriate_currency(company, filters)
    gl_entries_by_account = {}

    # extracts the root of the trees "Asset" and "Liability"
    # only two elements in this dict
    print("\tgetting list of accounts -- balance sheet [" + root_type + "]")
    
    gl_entries_by_account = {}
    for root in frappe.db.sql(
        """select lft, rgt from tabAccount
            where root_type=%s and ifnull(parent_account, '') = ''""",
        root_type,
        as_dict=1,
    ):

        set_gl_entries_by_account(
            company,
            period_list[0]["year_start_date"] if only_current_fiscal_year else None,
            period_list[-1]["to_date"],
            root.lft,
            root.rgt,
            filters,
            gl_entries_by_account,
            ignore_closing_entries=ignore_closing_entries,
        )

    calculate_values(
        accounts_by_name,
        gl_entries_by_account,
        period_list,
        accumulated_values,
        ignore_accumulated_values_for_fy,
    )

    accumulate_values_into_parents(accounts, accounts_by_name, period_list)
    out = prepare_balance_sheet_data(accounts, balance_must_be, period_list, company_currency)
    out = filter_out_zero_value_rows(out, parent_children_map)

    for data in out:
        if data: 
            if data.account[-5:] == " - WW":
                data.account = (data.account)[:-5]
            if data.parent_account[-5:] == " - WW":
                data.parent_account = (data.parent_account)[:-5]

    return out


## overriden from financial_statements.py -- calculates the dollar values to be put in each cell, one row at a time; called from get_balance_sheet_data()
def prepare_balance_sheet_data(accounts, balance_must_be, period_list, company_currency):
    data = []
    year_start_date = period_list[0]["year_start_date"].strftime("%Y-%m-%d")
    year_end_date = period_list[-1]["year_end_date"].strftime("%Y-%m-%d")

    for account in accounts:
        has_value = False
        total = 0
        print_group = frappe.db.sql(
            """
            SELECT  print_group 
            FROM    tabAccount 
            WHERE   name = %s
            """,
            account.name
        )

        row = frappe._dict(
            {
                "account": _(account.name),
                "parent_account": _(account.parent_account) if account.parent_account else "",
                "indent": flt(account.indent),
                "year_start_date": year_start_date,
                "year_end_date": year_end_date,
                "currency": company_currency,
                "include_in_gross": account.include_in_gross,
                "account_type": account.account_type,
                "is_group": account.is_group,
                "opening_balance": account.get("opening_balance", 0.0) * (1 if balance_must_be == "Debit" else -1),
                "account_name": (
                    "%s - %s" % (_(account.account_number), _(account.account_name))
                    if account.account_number
                    else _(account.account_name)
                ),
            }
        )

        for period in period_list:
            if account.get(period.key) and balance_must_be == "Credit":
                account[period.key] *= -1 # change sign based on Debit or Credit, since calculation is done using (debit - credit)

            row[period.key] = flt(account.get(period.key, 0.0), 3)

            # ignore zero values
            if abs(row[period.key]) >= 0.005:
                has_value = True
                total += flt(row[period.key])

        if (row.account[-5:] == " - WW"):
            row.account = (row.account)[:-5]

        if (row.parent_account[-5:] == " - WW"):
            row.parent_account = (row.parent_account)[:-5]

        if (row["is_group"] == False): 
            row["account"] = print_group[0][0]

        if (row["account"] == ""):
            row["account"] = row["account_name"]
            
        if (row["indent"] == 3):
            row["indent"] = 2

        if (row["parent_account"] == "Accounts Receivable" or
            row["parent_account"] == "Bank" or
            row["parent_account"] == "Inventory" or
            row["parent_account"] == "Other Current Assets"
        ): row["parent_account"] = "Current Assets"

        row["account"].replace("'", "")
        row["has_value"] = has_value
        row["total"] = total
        row["print_group"] = print_group[0][0]

        data.append(row)

    return data

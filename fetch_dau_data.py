#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DAU数据获取和存储程序
从Hive数据库获取DAU数据并存储到本地SQLite数据库
"""

import pandas as pd
from sqlalchemy import create_engine
import sqlite3
import datetime
import logging
from typing import Optional
import sys

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('dau_fetch.log', encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)

# 禁用pyhive和SQLAlchemy的调试日志
logging.getLogger('pyhive').setLevel(logging.WARNING)
logging.getLogger('sqlalchemy').setLevel(logging.WARNING)
logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)


class DAUDataFetcher:
    """DAU数据获取器"""

    def __init__(self, hive_host: str = '10.1.11.39', hive_port: int = 10011):
        """
        初始化Hive连接参数

        Args:
            hive_host: Hive服务器地址
            hive_port: Hive服务器端口
        """
        self.hive_host = hive_host
        self.hive_port = hive_port
        self.hive_engine = None

    def connect_to_hive(self) -> bool:
        """
        连接到Hive数据库

        Returns:
            bool: 连接是否成功
        """
        try:
            # 使用SQLAlchemy创建Hive连接，禁用调试输出
            connection_string = f"hive://{self.hive_host}:{self.hive_port}/default"
            self.hive_engine = create_engine(
                connection_string,
                echo=False  # 禁用SQL查询的调试输出
            )
            logger.info("成功连接到Hive数据库")
            return True
        except Exception as e:
            logger.error(f"连接Hive数据库失败: {e}")
            return False

    def fetch_dau_data(self, start_date: str, end_date: str) -> Optional[pd.DataFrame]:
        """
        从Hive获取DAU数据

        Args:
            start_date: 开始日期 (yyyy-MM-dd)
            end_date: 结束日期 (yyyy-MM-dd)

        Returns:
            pd.DataFrame: DAU数据，失败时返回None
        """
        if not hasattr(self, 'hive_engine') or self.hive_engine is None:
            logger.error("Hive连接未建立")
            return None

        query = f"""
        SELECT
            dt,
            gender,
            os_type,
            CASE
                WHEN recommend_type = 'T_NonBlueCollar' THEN '白领'
                ELSE '非白领'
            END as is_white_collar,
            age_group,
            dengji,
            education,
            -- DAU 统计
            SUM(CASE WHEN status='good' AND verification_status='verified' THEN num_user ELSE 0 END) as dau,
            -- 收入统计
            SUM(total_revenue) as total_revenue,
            SUM(hn_revenue) as hn_revenue,
            SUM(zizhu_revenue) as zizhu_revenue,
            SUM(after_tax_total_revenue) as after_tax_total_revenue,
            -- 留存统计
            SUM(returned_1d) as returned_1d
        FROM da.cpz_qs_metrics_i_d
        WHERE dt >= '{start_date}' AND dt <= '{end_date}'
          AND gender IS NOT NULL
        GROUP BY
            dt,
            gender,
            os_type,
            CASE
                WHEN recommend_type = 'T_NonBlueCollar' THEN '白领'
                ELSE '非白领'
            END,
            age_group,
            dengji,
            education
        """

        try:
            logger.info(f"正在获取 {start_date} 到 {end_date} 的DAU数据...")
            df = pd.read_sql(query, self.hive_engine)
            logger.info(f"成功获取 {len(df)} 条记录")
            return df
        except Exception as e:
            logger.error(f"获取DAU数据失败: {e}")
            return None

    def close_connection(self):
        """关闭Hive连接"""
        if hasattr(self, 'hive_engine') and self.hive_engine:
            self.hive_engine.dispose()
            logger.info("已关闭Hive连接")


class LocalDatabase:
    """本地SQLite数据库管理"""

    def __init__(self, db_path: str = 'dau_data.db'):
        """
        初始化本地数据库

        Args:
            db_path: SQLite数据库文件路径
        """
        self.db_path = db_path
        self.conn = None

    def connect(self) -> bool:
        """
        连接到本地SQLite数据库

        Returns:
            bool: 连接是否成功
        """
        try:
            self.conn = sqlite3.connect(self.db_path)
            logger.info(f"成功连接到本地数据库: {self.db_path}")
            return True
        except Exception as e:
            logger.error(f"连接本地数据库失败: {e}")
            return False

    def create_table(self) -> bool:
        """
        创建DAU数据表

        Returns:
            bool: 创建是否成功
        """
        if not self.conn:
            logger.error("数据库连接未建立")
            return False

        create_table_sql = """
        CREATE TABLE IF NOT EXISTS dau_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dt TEXT NOT NULL,
            gender TEXT,
            os_type TEXT,
            is_white_collar TEXT,
            age_group TEXT,
            dengji TEXT,
            education TEXT,
            dau INTEGER,
            total_revenue REAL,
            hn_revenue REAL,
            zizhu_revenue REAL,
            after_tax_total_revenue REAL,
            returned_1d INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(dt, gender, os_type, is_white_collar, age_group, dengji, education)
        )
        """

        try:
            cursor = self.conn.cursor()
            cursor.execute(create_table_sql)
            self.conn.commit()
            logger.info("DAU数据表创建/验证成功")
            return True
        except Exception as e:
            logger.error(f"创建数据表失败: {e}")
            return False

    def save_data(self, df: pd.DataFrame) -> bool:
        """
        保存数据到本地数据库

        Args:
            df: 要保存的数据

        Returns:
            bool: 保存是否成功
        """
        if not self.conn:
            logger.error("数据库连接未建立")
            return False

        if df.empty:
            logger.warning("没有数据需要保存")
            return True

        try:
            # 逐条插入，使用INSERT OR REPLACE处理重复数据
            cursor = self.conn.cursor()
            inserted_count = 0

            for _, row in df.iterrows():
                insert_sql = """
                INSERT OR REPLACE INTO dau_metrics
                (dt, gender, os_type, is_white_collar, age_group, dengji, education,
                 dau, total_revenue, hn_revenue, zizhu_revenue, after_tax_total_revenue, returned_1d)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """
                cursor.execute(insert_sql, (
                    row['dt'], row['gender'], row['os_type'], row['is_white_collar'],
                    row['age_group'], row['dengji'], row['education'], row['dau'],
                    row['total_revenue'], row['hn_revenue'], row['zizhu_revenue'],
                    row['after_tax_total_revenue'], row['returned_1d']
                ))
                inserted_count += 1

            self.conn.commit()
            logger.info(f"成功保存 {inserted_count} 条记录到数据库")
            return True
        except Exception as e:
            logger.error(f"保存数据失败: {e}")
            return False

    def close_connection(self):
        """关闭数据库连接"""
        if self.conn:
            self.conn.close()
            logger.info("已关闭数据库连接")


def get_recent_dates(days: int = 3) -> tuple:
    """
    获取最近几天的日期

    Args:
        days: 天数

    Returns:
        tuple: (start_date, end_date)
    """
    end_date = datetime.datetime.now().date()
    start_date = end_date - datetime.timedelta(days=days-1)

    return start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d')


def main():
    """主程序"""
    logger.info("开始获取DAU数据...")

    # 获取最近3天的日期
    start_date, end_date = get_recent_dates(3)
    logger.info(f"获取日期范围: {start_date} 到 {end_date}")

    # 初始化数据获取器
    fetcher = DAUDataFetcher()

    # 初始化本地数据库
    local_db = LocalDatabase()

    try:
        # 连接到Hive
        if not fetcher.connect_to_hive():
            logger.error("无法连接到Hive数据库，程序退出")
            return

        # 连接到本地数据库
        if not local_db.connect():
            logger.error("无法连接到本地数据库，程序退出")
            return

        # 创建数据表
        if not local_db.create_table():
            logger.error("创建数据表失败，程序退出")
            return

        # 获取DAU数据
        df = fetcher.fetch_dau_data(start_date, end_date)

        if df is not None and not df.empty:
            # 保存数据到本地数据库
            if local_db.save_data(df):
                logger.info("DAU数据获取和保存成功完成")

                # 显示数据概览
                print(f"\n数据概览:")
                print(f"数据日期范围: {df['dt'].min()} 到 {df['dt'].max()}")
                print(f"总记录数: {len(df)}")
                print(f"总DAU: {df['dau'].sum():,}")
                print(f"总收入: {df['total_revenue'].sum():,.2f}")
                print(f"红娘收入: {df['hn_revenue'].sum():,.2f}")
                print(f"自助收入: {df['zizhu_revenue'].sum():,.2f}")
            else:
                logger.error("保存数据失败")
        else:
            logger.warning("没有获取到数据")

    except Exception as e:
        logger.error(f"程序执行出错: {e}")

    finally:
        # 关闭连接
        fetcher.close_connection()
        local_db.close_connection()


if __name__ == "__main__":
    main()